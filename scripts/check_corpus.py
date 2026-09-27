"""Read-only Atlas retrieval checks for the curated corpus; no answer scoring claims."""

import asyncio
import json
import time
from datetime import datetime, timezone

from app.config import Settings, ROOT
from app.providers import Gemini
from app.repositories import MongoStore
from app.retrieval import retrieve

CASES = [
    ("india", "traditional knowledge aggregation duplication section 3 patent", "india-patents-act-2024"),
    ("international", "Hague international industrial design protection application", "wipo-hague"),
    ("us", "botanical drug development investigational new drug IND", "fda-botanical-guidance"),
    ("eu", "herbal medicinal products traditional use registration quality dossier", "ema-herbal"),
    ("uk", "traditional herbal registration thirty years traditional use", "uk-thr"),
]


async def main():
    settings = Settings()
    store = MongoStore(settings.mongodb_uri, settings.mongodb_database)
    llm = Gemini(settings.model_copy(update={"langsmith_tracing": False}))
    results = []
    try:
        await store.setup()
        documents = await store.find("documents", {"active_version": {"$ne": None}}, limit=0)
        chunks = await store.find("chunks", {"active": True}, limit=0)
        pointers = {document["_id"]: document["active_version"] for document in documents}
        assert chunks and all(chunk["version_id"] == pointers[chunk["document_id"]] for chunk in chunks)
        assert all(chunk["reviewed"] and chunk["locator"] and chunk["url"].startswith("https://") for chunk in chunks)
        assert all(len(chunk["embedding"]) == settings.embedding_dimensions and chunk["embedding_model"] == settings.embedding_model for chunk in chunks)
        for scope, query, expected in CASES:
            for method in ("bm25", "vector", "hybrid"):
                started = time.monotonic()
                try:
                    evidence, counts = await retrieve(store, llm, settings, query, scope, method)
                    assert evidence and expected in {item["document_id"] for item in evidence}
                    assert all(item["scope"] == scope and item["version_id"] == pointers[item["document_id"]] for item in evidence)
                    result = {"scope": scope, "method": method, "status": "passed", **counts}
                except Exception as exc:
                    result = {"scope": scope, "method": method, "status": "failed", "error": type(exc).__name__}
                result["latency_ms"] = round((time.monotonic() - started) * 1000)
                results.append(result)
                print(json.dumps(result), flush=True)
        report = {"checked_at": datetime.now(timezone.utc).isoformat(), "active_documents": len(documents),
                  "active_chunks": len(chunks), "checks": results,
                  "limitation": "Engineering retrieval smoke checks, not held-out accuracy or legal review."}
        (ROOT / "evaluation/reports/live-corpus.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        if any(result["status"] != "passed" for result in results):
            raise RuntimeError("Some corpus retrieval checks failed")
    finally:
        await store.close()
        await llm.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        raise SystemExit(f"Corpus check did not complete: {type(exc).__name__}. See the sanitized report.") from None
