"""Explicit live check: temporary Atlas accounts, search, Gemini and redacted tracing.

Run from the project root with .venv/Scripts/python.exe scripts/check_live.py.
Uses provider quota. Never imports or activates legal evidence or sends email.
"""

import asyncio
import json
import logging
import math
import secrets
from datetime import datetime, timezone
from uuid import uuid4

import httpx

from app.config import ROOT, Settings
from app.main import create_app
from app.providers import Gemini
from app.repositories import MongoStore
from app.schemas import QueryRewrite


async def accounts(settings):
    # This exact, fresh database is the only database this check can drop.
    database = f"sakti_check_{uuid4().hex[:12]}"
    store = MongoStore(settings.mongodb_uri, database)
    test_settings = settings.model_copy(
        update={
            "mongodb_database": database,
            "gemini_api_key": "",
            "langsmith_tracing": False,
            "smtp_host": "",
        }
    )
    app = create_app(test_settings, store=store)
    try:
        async with app.router.lifespan_context(app):
            try:
                transport = httpx.ASGITransport(app=app)
                async with httpx.AsyncClient(
                    transport=transport,
                    base_url=settings.app_origin,
                    headers={"Origin": settings.app_origin},
                ) as client:
                    email, password = (
                        f"check-{uuid4().hex}@example.com",
                        secrets.token_urlsafe(24),
                    )
                    response = await client.post(
                        "/api/v1/auth/register",
                        json={
                            "name": "Integration check",
                            "email": email,
                            "password": password,
                        },
                    )
                    assert response.status_code == 201, "registration"
                    user_id = response.json()["user"]["id"]
                    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
                    assert (await client.get("/api/v1/auth/me")).status_code == 200
                    response = await client.post(
                        "/api/v1/consultations", json={"title": "Temporary check"}
                    )
                    assert response.status_code == 201, "create consultation"
                    identifier = response.json()["id"]
                    saved_csrf = client.headers.pop("X-CSRF-Token")
                    assert (
                        await client.delete(f"/api/v1/consultations/{identifier}")
                    ).status_code == 403
                    client.headers["X-CSRF-Token"] = saved_csrf
                    assert (
                        await client.post("/api/v1/auth/logout", json={})
                    ).status_code == 200
                    assert (await client.get("/api/v1/auth/me")).status_code == 401
                    response = await client.post(
                        "/api/v1/auth/register",
                        json={
                            "name": "Other account",
                            "email": f"other-{email}",
                            "password": password,
                        },
                    )
                    assert response.status_code == 201
                    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
                    assert (
                        await client.get(f"/api/v1/consultations/{identifier}")
                    ).status_code == 404
                    assert (
                        await client.delete("/api/v1/auth/account")
                    ).status_code == 200
                    response = await client.post(
                        "/api/v1/auth/login",
                        json={"email": email, "password": password},
                    )
                    assert response.status_code == 200, "login"
                    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
                    exported = await client.get("/api/v1/auth/export")
                    assert exported.status_code == 200
                    assert exported.json()["consultations"][0]["id"] == identifier
                    assert (
                        await client.delete("/api/v1/auth/account")
                    ).status_code == 200
                    assert not await store.get("users", {"_id": user_id})
                    assert not await store.get("sessions", {"user_id": user_id})
                    assert not await store.get("consultations", {"_id": identifier})
                # Verify rollback against Atlas, not the in-memory test double.
                try:
                    async with store.transaction() as tx:
                        await tx.insert(
                            "users",
                            {"_id": "rollback-probe", "email": "rollback@example.com"},
                        )
                        raise ValueError("rollback probe")
                except ValueError:
                    pass
                assert not await store.get("users", {"_id": "rollback-probe"})
                return {
                    "registration_login_logout": True,
                    "ownership_csrf": True,
                    "export_deletion": True,
                    "transaction_rollback": True,
                }
            finally:
                await store.client.drop_database(database)
    finally:
        await store.close()


async def search(settings):
    store = MongoStore(settings.mongodb_uri, settings.mongodb_database)
    try:
        indexes = {
            item["name"]: item
            for item in await (await store.db.chunks.list_search_indexes()).to_list(
                length=None
            )
        }
        for filename in ("lexical-index.json", "vector-index.json"):
            expected = json.loads(
                (ROOT / "corpus/source-configs" / filename).read_text(encoding="utf-8")
            )
            actual = indexes.get(expected["name"], {})
            assert actual.get("queryable") is True, "search index not ready"
            definition = actual.get("latestDefinition", {})
            if expected["type"] == "vectorSearch":
                for field in expected["definition"]["fields"]:
                    if field["type"] == "vector":
                        field["numDimensions"] = settings.embedding_dimensions
                assert definition.get("fields") == expected["definition"]["fields"], (
                    "vector mapping mismatch"
                )
            else:
                assert (
                    definition.get("mappings") == expected["definition"]["mappings"]
                ), "lexical mapping mismatch"
        parameters = ("india", settings.embedding_model, settings.embedding_dimensions)
        lexical, vector = await asyncio.gather(
            store.lexical_search("patent research", *parameters),
            store.vector_search(
                [1.0] + [0.0] * (settings.embedding_dimensions - 1), *parameters
            ),
        )
        return {
            "lexical_query": True,
            "vector_query": True,
            "active_documents": await store.db.documents.count_documents(
                {"active_version": {"$ne": None}}
            ),
            "returned_candidates": {"lexical": len(lexical), "vector": len(vector)},
        }
    finally:
        await store.close()


async def main():
    logging.disable(logging.CRITICAL)
    settings = Settings()
    if not settings.mongodb_uri or not settings.gemini_api_key:
        raise ValueError("Configure MongoDB and Gemini first")
    if settings.app_env != "development":
        raise ValueError("Run this check only with development settings")
    # Even if content capture is enabled elsewhere, the check verifies redacted traces.
    llm = Gemini(settings.model_copy(update={"langsmith_capture_content": False}))
    results = []

    async def check(name, operation):
        started = asyncio.get_running_loop().time()
        try:
            async with asyncio.timeout(120):
                details = await operation()
            result = {"check": name, "status": "passed", "details": details}
        except Exception as exc:
            result = {
                "check": name,
                "status": "failed",
                "error_type": type(exc).__name__,
            }
            if isinstance(getattr(exc, "code", None), int):
                result["code"] = exc.code
        result["elapsed_ms"] = round(
            (asyncio.get_running_loop().time() - started) * 1000
        )
        results.append(result)
        print(json.dumps(result), flush=True)

    async def generation():
        value = await llm.structured(
            "Return the supplied query unchanged.",
            {"query": "patent research"},
            QueryRewrite,
        )
        assert value.query == "patent research"
        return {"model": settings.gemini_model, "structured_output": True}

    async def embedding():
        vectors = [
            await llm.embed("patent research", task)
            for task in ("RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY")
        ]
        assert all(
            math.isclose(sum(x * x for x in vector), 1.0, abs_tol=1e-6)
            for vector in vectors
        )
        return {
            "model": settings.embedding_model,
            "dimensions": len(vectors[0]),
            "both_task_types": True,
        }

    async def tracing():
        from langsmith.utils import LangSmithNotFoundError

        client = llm.observer.client
        if client is None:
            return {"enabled": False}
        with llm.observer.span(
            "live-backend-check",
            {"check": True},
            {"private_probe": "must-not-be-exported"},
        ) as span:
            identifier = span.id
            span.end(outputs={"private_probe": "must-not-be-exported"})
        await asyncio.to_thread(client.flush)
        # Ingestion is asynchronous: an accepted trace is not immediately queryable.
        for attempt in range(6):
            try:
                run = await asyncio.to_thread(client.read_run, identifier)
                break
            except LangSmithNotFoundError:
                if attempt == 5:
                    raise
                await asyncio.sleep(2)
        assert not run.inputs and not run.outputs, "trace redaction"
        return {"delivered": True, "content_redacted": True}

    try:
        await check("atlas_accounts_transactions", lambda: accounts(settings))
        await check("atlas_search", lambda: search(settings))
        await check("gemini_generation", generation)
        await check("gemini_embeddings", embedding)
        await check("langsmith_delivery_redaction", tracing)
    finally:
        await llm.close()
    report = ROOT / "evaluation/reports/live-backend.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps(
            {
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "checks": results,
                "scope": "Engineering integration check; not a legal-answer quality benchmark.",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return int(any(result["status"] == "failed" for result in results))


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as exc:
        print(json.dumps({"status": "failed", "error_type": type(exc).__name__}))
        raise SystemExit(1) from None
