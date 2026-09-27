"""Hybrid search and evidence selection, independent of generation and the UI."""

import asyncio
from datetime import date


def fuse_results(lexical, vector, limit=20):
    scores = {}
    for results in (lexical, vector):
        for rank, item in enumerate(results, start=1):
            entry = scores.setdefault(item["_id"], [0.0, item])
            entry[0] += 1 / (60 + rank)
    return [
        item
        for _, item in sorted(scores.values(), key=lambda pair: pair[0], reverse=True)[
            :limit
        ]
    ]


def current_evidence(chunk, scope):
    today = date.today().isoformat()
    return (
        chunk.get("scope") == scope
        and chunk.get("active") is True
        and chunk.get("reviewed") is True
        and chunk.get("current_reviewed") is True
        and chunk.get("access") == "public"
        and chunk.get("legal_status")
        in {"in_force", "official_guidance", "adopted_not_in_force"}
        and (not chunk.get("effective_from") or chunk["effective_from"] <= today)
        and (not chunk.get("effective_until") or chunk["effective_until"] >= today)
        and bool(chunk.get("locator"))
        and bool(chunk.get("version_id"))
    )


def select_evidence(candidates, documents, scope, final_k, character_budget):
    active = {doc["_id"]: doc.get("active_version") for doc in documents}
    evidence, seen, used = [], set(), 0
    for chunk in candidates:
        if (
            not current_evidence(chunk, scope)
            or active.get(chunk["document_id"]) != chunk["version_id"]
        ):
            continue
        identity = (chunk["document_id"], chunk["content"])
        if identity in seen or used + len(chunk["content"]) > character_budget:
            continue
        seen.add(identity)
        evidence.append(chunk)
        used += len(chunk["content"])
        if len(evidence) >= final_k:
            break
    return evidence


async def retrieve(store, llm, settings, query, scope, variant="hybrid"):
    if variant not in {"bm25", "vector", "hybrid"}:
        raise ValueError("Unknown retrieval variant")
    parameters = (
        scope,
        settings.embedding_model,
        settings.embedding_dimensions,
        settings.retrieval_candidates,
    )

    async def semantic():
        vector = await llm.embed(query, task_type="RETRIEVAL_QUERY")
        return await store.vector_search(vector, *parameters)

    async def empty():
        return []

    lexical, vector = await asyncio.gather(
        store.lexical_search(query, *parameters) if variant != "vector" else empty(),
        semantic() if variant != "bm25" else empty(),
    )
    candidates = fuse_results(lexical, vector, settings.retrieval_shortlist)
    seeds = candidates[: max(1, settings.retrieval_final_k // 2)]
    ids = [chunk["_id"] for chunk in seeds]
    # Ponytail: only one reviewed graph hop, capped at 8 edges; no open-ended graph traversal.
    relations = await store.find(
        "knowledge_relations",
        {"scope": scope, "from_chunk": {"$in": ids}, "reviewed": True},
        limit=8,
    )
    versions = {chunk["_id"]: chunk["version_id"] for chunk in seeds}
    relations = [
        edge
        for edge in relations
        if edge.get("from_version") == versions.get(edge["from_chunk"])
    ]
    related_ids = list(dict.fromkeys(edge["to_chunk"] for edge in relations))
    if related_ids:
        related = await store.find("chunks", {"_id": {"$in": related_ids}}, limit=8)
        valid_targets = {(edge["to_chunk"], edge["to_version"]) for edge in relations}
        related = [
            chunk
            for chunk in related
            if (chunk["_id"], chunk["version_id"]) in valid_targets
        ]
        candidates = seeds + related + candidates[len(seeds) :]
    documents = await store.find(
        "documents",
        {"_id": {"$in": list({c["document_id"] for c in candidates})}},
        limit=100,
    )
    selected = select_evidence(
        candidates,
        documents,
        scope,
        settings.retrieval_final_k,
        settings.retrieval_context_chars,
    )
    return selected, {
        "lexical_candidates": len(lexical),
        "vector_candidates": len(vector),
        "shortlist_count": len(candidates),
        "selected_count": len(selected),
    }
