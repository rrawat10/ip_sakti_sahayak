"""Offline integration checks: actual graph and ingestion, controlled provider outputs."""

from types import SimpleNamespace
import pytest
from app.config import Settings
from app.schemas import Analysis, Draft, Section, SupportCheck, QueryRewrite
from app.workflow import ConsultationWorkflow
from ingestion.pipeline import ingest, activate, link_evidence, Review
from app.retrieval import retrieve
from test_system import MemoryStore


class SearchStore(MemoryStore):
    async def lexical_search(self, *args):
        return self.data.get("chunks", [])

    async def vector_search(self, *args):
        return self.data.get("chunks", [])


def test_treaty_adoption_cannot_imply_entry_into_force():
    metadata = {
        "reviewer": "Reviewer",
        "current_reviewed": True,
        "locator_verified": True,
        "legal_status": "adopted_not_in_force",
        "adopted_on": "2024-01-01",
    }
    assert Review.model_validate(metadata).entered_into_force is None
    with pytest.raises(ValueError):
        Review.model_validate({**metadata, "effective_from": "2024-02-01"})
    with pytest.raises(ValueError):
        Review.model_validate(
            {**metadata, "legal_status": "in_force", "effective_from": "2024-02-01"}
        )


class Provider:
    def __init__(self, supported=True, fail=False):
        self.calls = []
        self.supported, self.fail = supported, fail

    async def structured(self, instructions, payload, schema):
        self.calls.append(schema.__name__)
        if self.fail:
            raise RuntimeError("secret-provider-detail")
        if schema is Analysis:
            return Analysis(intent="research", domains=["patents"])
        if schema is QueryRewrite:
            return QueryRewrite(query="reformulated question")
        if schema is SupportCheck:
            return SupportCheck(
                supported=self.supported,
                scope_correct=True,
                temporal_correct=True,
                uncertainty_appropriate=True,
                conflicts_addressed=True,
                sections=[
                    {
                        "section_index": i,
                        "citation_ids": section["citation_ids"],
                        "supported": self.supported,
                    }
                    for i, section in enumerate(payload["answer"]["sections"])
                ],
            )
        return Draft(
            status="answered",
            title="Answer",
            short_answer="Supported statement",
            sections=[
                Section(
                    heading="Basis", text="Supported statement", citation_ids=["c1"]
                )
            ],
        )

    async def embed(self, text, task_type="RETRIEVAL_DOCUMENT"):
        return [1.0] * 128


def evidence_store():
    store = SearchStore()
    store.data["documents"] = [{"_id": "doc", "active_version": "v1"}]
    store.data["chunks"] = [
        {
            "_id": "c1",
            "document_id": "doc",
            "version_id": "v1",
            "scope": "india",
            "active": True,
            "reviewed": True,
            "current_reviewed": True,
            "access": "public",
            "legal_status": "official_guidance",
            "content": "Supported statement",
            "locator": "Page 1",
            "title": "Source",
            "authority": "Authority",
            "url": "https://example.org/source",
            "reviewed_at": "2026-01-01",
        }
    ]
    return store


@pytest.mark.asyncio
async def test_graph_progress_repair_scope_and_provider_failure():
    settings = Settings(_env_file=None, langsmith_tracing=False)
    provider = Provider()
    events = []

    async def emit(event):
        events.append(event)

    workflow = ConsultationWorkflow(evidence_store(), provider, settings)
    answer, trace = await workflow.run("Question", "india", "en", [], {}, on_event=emit)
    assert (
        answer["status"] == "answered" and answer["citations"][0]["version_id"] == "v1"
    )
    assert [e["stage"] for e in events if e["status"] == "running"] == [
        "analyze",
        "retrieve",
        "generate",
        "validate",
    ]
    assert trace["validation"]["supported"]
    assert all(answer["evidence_review"]["checks"].values())
    assert answer["evidence_review"]["sections_checked"] == 1
    provider.supported = False
    answer, trace = await workflow.run("Question", "india", "en", [], {})
    assert answer["status"] == "abstained" and trace["repair_count"] == 2
    answer, trace = await workflow.run("Question", "us", "en", [], {})
    assert answer["status"] == "abstained" and trace["retrieval_attempt"] == 1
    assert trace["retrieved_ids"] == []
    provider.fail = True
    answer, trace = await workflow.run("Question", "india", "en", [], {})
    assert answer["status"] == "error" and trace["error_type"] == "RuntimeError"
    assert "secret-provider-detail" not in str((answer, trace))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fault",
    [
        "missing_section",
        "duplicate_section",
        "wrong_citation",
        "unsupported_claims",
        "temporal_correct",
        "uncertainty_appropriate",
        "conflicts_addressed",
        "scope_correct",
    ],
)
async def test_global_judge_approval_cannot_bypass_evidence_checks(fault):
    class FaultyJudge(Provider):
        async def structured(self, instructions, payload, schema):
            result = await super().structured(instructions, payload, schema)
            if schema is SupportCheck:
                data = result.model_dump()
                if fault == "missing_section":
                    data["sections"] = []
                elif fault == "duplicate_section":
                    data["sections"] *= 2
                elif fault == "wrong_citation":
                    data["sections"][0]["citation_ids"] = ["invented"]
                elif fault == "unsupported_claims":
                    data["unsupported_claims"] = ["Unsupported conclusion"]
                else:
                    data[fault] = False
                return SupportCheck.model_validate(data)
            return result

    workflow = ConsultationWorkflow(
        evidence_store(),
        FaultyJudge(),
        Settings(_env_file=None, langsmith_tracing=False),
    )
    answer, trace = await workflow.run("Question", "india", "en", [], {})
    assert answer["status"] == "abstained"
    assert trace["repair_count"] == 2
    assert not all(answer["evidence_review"]["checks"].values())
    assert not answer["citations"]


@pytest.mark.asyncio
async def test_source_update_preserves_active_version_until_review(tmp_path):
    store = MemoryStore()
    settings = SimpleNamespace(
        storage_path=tmp_path, embedding_dimensions=128, embedding_model="test"
    )
    config = {
        "id": "official",
        "permissions_reviewed": True,
        "allowed_types": ["text/html"],
        "scope": "india",
        "title": "Source",
        "authority": "Authority",
        "url": "https://example.org/source",
    }
    raw = b"<main>Section 1\nOriginal provision text for review.</main>"
    first = await ingest(store, settings, config, "doc", raw, "text/html", "Section 1")
    duplicate = await ingest(
        store, settings, config, "doc", raw, "text/html", "Section 1"
    )
    assert duplicate["duplicate"] and first["version_id"] == duplicate["version_id"]
    review = {
        "reviewer": "Test reviewer",
        "current_reviewed": True,
        "locator_verified": True,
        "legal_status": "official_guidance",
    }
    await activate(store, Provider(), settings, first["version_id"], review)
    changed = await ingest(
        store,
        settings,
        config,
        "doc",
        raw.replace(b"Original", b"Amended"),
        "text/html",
        "Section 1",
    )
    assert (
        changed["version_id"] != first["version_id"]
        and not changed["text_matches_active"]
    )
    assert (await store.get("documents", {"_id": "doc"}))["active_version"] == first[
        "version_id"
    ]

    class FailedEmbedding(Provider):
        async def embed(self, *args):
            raise RuntimeError("Service unavailable")

    with pytest.raises(RuntimeError):
        await activate(
            store, FailedEmbedding(), settings, changed["version_id"], review
        )
    assert (await store.get("documents", {"_id": "doc"}))["active_version"] == first[
        "version_id"
    ]
    await activate(store, Provider(), settings, changed["version_id"], review)
    assert (await store.get("documents", {"_id": "doc"}))["active_version"] == changed[
        "version_id"
    ]
    assert all(
        c["version_id"] == changed["version_id"]
        for c in await store.find("chunks", {"active": True})
    )
    assert (tmp_path / "corpus").is_dir()


@pytest.mark.asyncio
async def test_graph_edges_are_version_bound_and_can_supply_a_definition():
    store = evidence_store()
    definition = {
        **store.data["chunks"][0],
        "_id": "definition",
        "content": "Definition of a relevant term",
    }
    store.data["chunks"].append(definition)
    await link_evidence(
        store,
        "c1",
        "definition",
        "defines",
        "Reviewer",
        "The provision explicitly refers to this definition.",
    )

    async def search(*args):
        return [store.data["chunks"][0]]

    store.lexical_search = search
    settings = Settings(_env_file=None, retrieval_final_k=2)
    results, _ = await retrieve(
        store, Provider(), settings, "question", "india", "bm25"
    )
    assert [c["_id"] for c in results] == ["c1", "definition"]
    store.data["knowledge_relations"][0]["from_version"] = "stale-version"
    results, _ = await retrieve(
        store, Provider(), settings, "question", "india", "bm25"
    )
    assert [c["_id"] for c in results] == ["c1"]
    definition["scope"] = "us"
    with pytest.raises(ValueError, match="same scope"):
        await link_evidence(
            store, "c1", "definition", "requires", "Reviewer", "Unrelated territory."
        )
