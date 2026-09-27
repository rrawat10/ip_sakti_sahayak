import copy
from contextlib import asynccontextmanager
from types import SimpleNamespace
from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError
from app.config import Settings
from app.main import create_app
from app.repositories import now
from app.schemas import Draft, Section
from app.workflow import abstention, valid_citations
from app.retrieval import current_evidence, fuse_results
from ingestion.pipeline import chunk_pages, extract, activate


class MemoryStore:
    """Isolated test double; never used by the live application."""

    def __init__(self):
        self.data = {}
        self.counts = {}

    async def setup(self):
        pass

    async def close(self):
        pass

    @asynccontextmanager
    async def transaction(self):
        snapshot = copy.deepcopy(self.data)
        try:
            yield self
        except Exception:
            self.data = snapshot
            raise

    def matches(self, doc, query):
        for key, value in query.items():
            actual = doc.get(key)
            if isinstance(value, dict):
                for operator, target in value.items():
                    if operator == "$gt" and not (
                        actual is not None and actual > target
                    ):
                        return False
                    if operator == "$gte" and not (
                        actual is not None and actual >= target
                    ):
                        return False
                    if operator == "$lt" and not (
                        actual is not None and actual < target
                    ):
                        return False
                    if operator == "$lte" and not (
                        actual is not None and actual <= target
                    ):
                        return False
                    if operator == "$ne" and actual == target:
                        return False
                    if operator == "$exists" and (key in doc) != target:
                        return False
                    if operator == "$in" and actual not in target:
                        return False
            elif actual != value:
                return False
        return True

    async def get(self, collection, query):
        return next(
            (
                copy.deepcopy(d)
                for d in self.data.get(collection, [])
                if self.matches(d, query)
            ),
            None,
        )

    async def find(self, collection, query, limit=500, sort=None):
        rows = [
            copy.deepcopy(d)
            for d in self.data.get(collection, [])
            if self.matches(d, query)
        ]
        if sort:
            for key, direction in reversed(sort):
                rows.sort(key=lambda d: d[key], reverse=direction < 0)
        return rows[:limit] if limit else rows

    async def insert(self, collection, document):
        if await self.get(collection, {"_id": document["_id"]}) or (
            collection == "users"
            and await self.get(collection, {"email": document["email"]})
        ):
            raise DuplicateKeyError("duplicate")
        self.data.setdefault(collection, []).append(copy.deepcopy(document))
        return document

    async def update(self, collection, query, changes):
        for document in self.data.get(collection, []):
            if self.matches(document, query):
                document.update(copy.deepcopy(changes))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete(self, collection, query):
        self.data[collection] = [
            d for d in self.data.get(collection, []) if not self.matches(d, query)
        ]

    async def consume(self, collection, query):
        result = await self.get(collection, query)
        if result:
            await self.delete(collection, {"_id": result["_id"]})
        return result

    async def lease(self, identifier, owner):
        d = await self.get("consultations", {"_id": identifier, "owner_id": owner})
        if not d or d.get("busy_until", now() - timedelta(seconds=1)) > now():
            return None
        token = str(uuid4())
        await self.update(
            "consultations",
            {"_id": identifier},
            {"lease_token": token, "busy_until": now() + timedelta(minutes=3)},
        )
        return token

    async def release(self, identifier, token):
        await self.update(
            "consultations",
            {"_id": identifier, "lease_token": token},
            {"busy_until": now() - timedelta(seconds=1)},
        )

    async def rate_limit(self, key, maximum, seconds):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key] <= maximum


class FakeWorkflow:
    def __init__(self):
        self.calls = []

    async def run(self, query, scope, language, history, facts, *, on_event=None):
        if on_event:
            await on_event({"stage": "retrieve", "status": "running"})
        self.calls.append((query, scope, history, facts))
        return abstention(scope, language), {}


@pytest.fixture
def system(tmp_path):
    store = MemoryStore()
    workflow = FakeWorkflow()
    settings = Settings(
        _env_file=None, app_env="test", data_dir=str(tmp_path), mongodb_uri="", gemini_api_key=""
    )
    app = create_app(settings, store, workflow)
    with TestClient(app) as client:
        client.headers["Origin"] = settings.app_origin
        yield client, store, workflow


def register(client, email="researcher@example.com"):
    identifier = str(uuid4())
    user = {"_id": identifier, "name": "Researcher", "email": email, "created_at": now()}
    client.app.state.store.data.setdefault("users", []).append(user)
    client.headers["Authorization"] = f"Bearer test:{identifier}"
    return {"id": identifier, "name": user["name"], "email": email}


def test_guest_stream_does_not_persist_and_filters_history(system):
    client, store, workflow = system
    body = {
        "content": "How does the PCT work?", "scope": "international", "language": "en",
        "request_id": str(uuid4()),
        "history": [
            {"role": "user", "content": "Indian question", "scope": "india"},
            {"role": "user", "content": "PCT question", "scope": "international"},
        ],
    }
    response = client.post("/api/v1/demo/messages/stream", json=body)
    assert response.status_code == 200
    assert "event: progress" in response.text and "event: result" in response.text
    assert workflow.calls[0][2] == [body["history"][1]]
    assert store.data == {}
    assert client.app.state.demo_llm.observer.client is None
    for _ in range(9):
        assert client.post("/api/v1/demo/messages/stream", json=body).status_code == 200
    assert client.post("/api/v1/demo/messages/stream", json=body).status_code == 429
    body["history"] *= 7
    assert client.post("/api/v1/demo/messages/stream", json=body).status_code == 422


def test_coverage_reports_active_versions_only(system):
    client, store, _ = system
    store.data["documents"] = [{"_id": "doc", "active_version": "v1"}, {"_id": "pending", "active_version": None}]
    store.data["document_versions"] = [
        {"_id": version, "document_id": "doc", "source_id": "pct", "reviewed": True,
         "title": "PCT introduction", "authority": "WIPO", "scope": "international",
         "base_locator": "PCT introduction", "url": "https://www.wipo.int/pct/",
         "chunk_count": 3, "reviewed_at": "2026-09-27",
         "review": {"review_type": "engineering", "legal_status": "official_guidance"}}
        for version in ("v1", "old")
    ]
    result = client.get("/api/v1/sources/coverage").json()
    assert result["active_documents"] == 1 and result["active_chunks"] == 3
    assert result["documents"][0]["version_id"] == "v1"


def test_built_frontend_fonts_and_spa_routes(tmp_path, monkeypatch):
    import app.main as main

    dist = tmp_path / "frontend/dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "fonts").mkdir()
    (dist / "fonts/geist.woff2").write_bytes(b"font-test-bytes")
    (dist / "index.html").write_text("<html>Application</html>")
    monkeypatch.setattr(main, "ROOT", tmp_path)
    app = create_app(Settings(_env_file=None, gemini_api_key=""), MemoryStore())
    with TestClient(app) as client:
        response = client.get("/fonts/geist.woff2")
        assert response.content == b"font-test-bytes"
        assert response.headers["content-type"] == "font/woff2"
        assert client.get("/fonts/missing.woff2").status_code == 404
        assert client.get("/workspace").text == "<html>Application</html>"
        assert client.get("/api/missing").status_code == 404


def test_source_selector_excludes_navigation_and_refuses_changed_layout():
    html = b'<main><aside>Section 99: menu only</aside><div id="sectionBody">Section 3\nActual provision text</div></main>'
    pages = extract(html, "text/html", "#sectionBody")
    assert pages[0]["content"] == "Section 3\nActual provision text"
    assert "menu" not in pages[0]["content"]
    with pytest.raises(ValueError, match="selector was not found"):
        extract(html, "text/html", "#removed-by-site-update")


@pytest.mark.asyncio
async def test_failed_startup_closes_database_and_provider():
    closed = []

    class FailedStore(MemoryStore):
        async def setup(self):
            raise RuntimeError("unavailable database")

        async def close(self):
            closed.append("database")

    app = create_app(Settings(_env_file=None, gemini_api_key=""), FailedStore())

    async def close_provider():
        closed.append("provider")

    app.state.llm.close = close_provider
    with pytest.raises(RuntimeError, match="unavailable database"):
        async with app.router.lifespan_context(app):
            pass
    assert closed == ["database", "provider"]


def test_clerk_identity_ownership_and_data_deletion(system):
    client, store, _ = system
    assert client.get("/api/v1/consultations").status_code == 401
    user = register(client)
    created = client.post(
        "/api/v1/consultations", json={"title": "Private research"}
    ).json()
    register(client, "second@example.com")
    assert client.get(f"/api/v1/consultations/{created['id']}").status_code == 404
    assert client.get("/api/v1/consultations").json() == []
    assert client.delete("/api/v1/auth/account").status_code == 200
    assert client.get("/api/v1/consultations").status_code == 401


def test_scope_isolation_and_idempotency(system):
    client, store, workflow = system
    register(client)
    c = client.post("/api/v1/consultations", json={"title": "Research"}).json()
    url = f"/api/v1/consultations/{c['id']}/messages"
    body = {
        "content": "Patent question",
        "scope": "india",
        "language": "en",
        "request_id": str(uuid4()),
    }
    first = client.post(url, json=body)
    assert first.status_code == 200, first.text
    assert len(client.post(url, json=body).json()["messages"]) == 2
    assert len(workflow.calls) == 1
    assert (
        client.post(url, json={**body, "content": "Different input"}).status_code == 409
    )
    result = client.post(url, json={**body, "scope": "us", "request_id": str(uuid4())})
    assert result.status_code == 200, result.text
    assert workflow.calls[-1][2] == []
    assert set(result.json()["assessments"]) == {"india", "us"}
    assert client.post(url, json={**body, "scope": "mars"}).status_code == 422
    assert (
        client.post(
            "/api/v1/feedback", json={"message_id": "unknown", "rating": 1}
        ).status_code
        == 404
    )


def test_invalid_identity_and_origin(system):
    client, store, _ = system
    register(client)
    response = client.post(
        "/api/v1/consultations", json={}, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403
    client.headers["Authorization"] = "Bearer test:unknown-user"
    assert client.get("/api/v1/consultations").status_code == 401


def test_account_export_is_complete_private_and_contains_no_password_hash(system):
    client, store, _ = system
    user = register(client)
    store.data["consultations"] = [
        {
            "_id": str(i),
            "owner_id": user["id"],
            "title": "Research",
            "updated_at": now(),
        }
        for i in range(501)
    ]
    store.data["consultations"].append(
        {"_id": "other", "owner_id": "another-user", "updated_at": now()}
    )
    response = client.get("/api/v1/auth/export")
    assert response.status_code == 200
    assert len(response.json()["consultations"]) == 501
    assert "password_hash" not in response.text and "another-user" not in response.text


def test_connectors_require_scoped_unexpired_revocable_consent(system):
    client, store, _ = system
    register(client)

    class Connector:
        name = "Test provider"
        scopes = ["india"]
        calls = []

        async def search(self, query, scope):
            self.calls.append((query, scope))
            return [{"title": "Authorized test record"}]

    connector = Connector()
    client.app.state.connectors["test"] = connector
    body = {
        "provider": "test",
        "scope": "india",
        "purpose": "Research evidence",
        "permission_confirmed": False,
    }
    assert client.post("/api/v1/connectors/grants", json=body).status_code == 422
    assert (
        client.post(
            "/api/v1/connectors/grants", json={**body, "permission_confirmed": "yes"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/connectors/grants",
            json={**body, "scope": "us", "permission_confirmed": True},
        ).status_code
        == 422
    )
    grant = client.post(
        "/api/v1/connectors/grants", json={**body, "permission_confirmed": True}
    ).json()
    query = {"grant_id": grant["id"], "query": "Research"}
    assert client.post("/api/v1/connectors/search", json=query).status_code == 200
    assert connector.calls == [("Research", "india")]
    store.data["connector_grants"][0]["expires_at"] = now() - timedelta(seconds=1)
    assert client.post("/api/v1/connectors/search", json=query).status_code == 403
    store.data["connector_grants"][0]["expires_at"] = now() + timedelta(minutes=1)
    assert client.delete(f"/api/v1/connectors/grants/{grant['id']}").status_code == 200
    assert client.post("/api/v1/connectors/search", json=query).status_code == 403
    assert len(connector.calls) == 1


def test_stream_progress_result_and_retry(system):
    client, store, workflow = system
    register(client)
    consultation = client.post(
        "/api/v1/consultations", json={"title": "Stream check"}
    ).json()
    url = f"/api/v1/consultations/{consultation['id']}/messages/stream"
    body = {
        "content": "Patent question",
        "scope": "india",
        "language": "en",
        "request_id": str(uuid4()),
    }
    response = client.post(url, json=body)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: progress" in response.text
    assert "event: result" in response.text
    assert response.text.index("event: progress") < response.text.index("event: result")
    assert "event: result" in client.post(url, json=body).text
    assert len(workflow.calls) == 1
    conflict = client.post(url, json={**body, "scope": "us"})
    assert "event: error" in conflict.text and "409" in conflict.text


def test_provider_outage_is_retryable_without_saving_a_false_abstention(system):
    client, store, workflow = system
    register(client)
    consultation = client.post("/api/v1/consultations", json={"title": "Retry"}).json()

    class Unavailable:
        async def run(self, *args, **kwargs):
            return {
                **abstention("india", "en"),
                "status": "error",
                "short_answer": "Service unavailable. Retry.",
            }, {"error_type": "TimeoutError"}

    client.app.state.workflow = Unavailable()
    body = {
        "content": "Research question",
        "scope": "india",
        "language": "en",
        "request_id": str(uuid4()),
    }
    url = f"/api/v1/consultations/{consultation['id']}/messages"
    assert client.post(url, json=body).status_code == 503
    assert store.data.get("messages", []) == []
    assert store.data["runs"][0]["status"] == "error"
    client.app.state.workflow = workflow
    assert client.post(url, json=body).status_code == 200
    assert len(store.data["messages"]) == 2


def test_password_endpoints_are_owned_by_clerk(system):
    client, _, _ = system
    for path in ["register", "login", "forgot-password", "reset-password", "logout"]:
        assert client.post(f"/api/v1/auth/{path}", json={}).status_code == 405


def test_unconfigured_backend_is_honest():
    with TestClient(
        create_app(Settings(_env_file=None, mongodb_uri="", gemini_api_key=""))
    ) as client:
        assert client.get("/api/health/live").status_code == 200
        assert client.get("/api/health/ready").status_code == 503
        assert client.get("/api/v1/sources").status_code == 200
        assert client.get("/api/v1/consultations").status_code == 503


def test_evidence_temporal_scope_and_citations():
    c = {
        "_id": "chunk1",
        "scope": "india",
        "active": True,
        "reviewed": True,
        "current_reviewed": True,
        "access": "public",
        "legal_status": "in_force",
        "locator": "Section 3(p)",
        "version_id": "v1",
    }
    assert current_evidence(c, "india")
    for invalid in [
        {"scope": "us"},
        {"active": False},
        {"access": "restricted"},
        {"legal_status": "draft"},
        {"effective_from": "2999-01-01"},
        {"effective_until": "2000-01-01"},
    ]:
        assert not current_evidence({**c, **invalid}, "india")
    draft = Draft(
        status="answered",
        title="Title",
        short_answer="Summary",
        sections=[
            Section(heading="Basis", text="Supported text", citation_ids=["chunk1"])
        ],
    )
    assert valid_citations(draft, [c])
    draft.sections[0].citation_ids = ["invented"]
    assert not valid_citations(draft, [c])
    assert fuse_results([c], [c])[0]["_id"] == "chunk1"


def test_parser_locators_and_unreviewed_activation():
    pages = extract(
        b"<html><nav>Ignore navigation</nav><main><h1>Section 3</h1><p>Actual provision text.</p></main></html>",
        "text/html",
    )
    assert "Ignore navigation" not in pages[0]["content"]
    chunks = chunk_pages(
        [{"page": 2, "content": "Section 3\n" + "Actual provision. " * 300}], "Act"
    )
    assert len(chunks) > 1 and all("PDF page 2" in c["locator"] for c in chunks)
    assert all(c["content"] for c in chunks)


@pytest.mark.asyncio
async def test_activation_requires_review():
    store = MemoryStore()
    await store.insert("document_versions", {"_id": "v1"})
    with pytest.raises(ValueError, match="Reviewer"):
        await activate(store, None, None, "v1", {})
