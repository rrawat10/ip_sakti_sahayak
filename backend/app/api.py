import asyncio
import json
import time
from datetime import timedelta
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from contextlib import suppress
from .config import ROOT
from .repositories import now
from .schemas import (
    ConsultationInput,
    MessageInput,
    DemoMessageInput,
    FeedbackInput,
    SpeechInput,
    USER_FACT_FIELDS,
)
from .security import (
    authenticate,
    store_for,
    public_user,
    digest,
    touch_user,
)
from .providers import speech
from .workflow import ConsultationWorkflow

router = APIRouter(prefix="/api/v1")
CATALOG = json.loads((ROOT / "corpus/catalog.json").read_text(encoding="utf-8"))
SOURCE_TOPICS = {
    "wipo-pct-faq": ["pct", "patents"],
    "wipo-hague": ["hague", "designs"],
    "wipo-budapest": ["budapest", "patents"],
    "wipo-gratk": ["gratk", "traditional-knowledge", "patents"],
    "wipo-secrets": ["trade-secrets"],
    "wipo-madrid": ["madrid", "trademarks"],
    "india-patents-act-2024": ["patents", "traditional-knowledge"],
    "india-patent-amendment-rules-2024": ["patents", "regulation"],
    "india-patent-second-amendment-rules-2024": ["patents", "regulation"],
    "india-asu-definitions": ["classification", "regulation"],
    "india-biodiversity-amendment-act-2023": ["abs", "traditional-knowledge"],
    "india-biodiversity-rules-2024": ["abs", "traditional-knowledge"],
    "india-biodiversity-amendment-rules-2025": ["abs", "classification"],
    "india-ayurveda-aahara-regulations-2022": ["food", "classification", "labelling"],
    "india-cosmetics-rules-2020": ["cosmetics", "classification", "labelling"],
    "india-phytopharmaceutical-faq": ["classification", "regulation"],
    "fda-botanical-guidance": ["exports", "regulation"],
    "ema-herbal": ["exports", "regulation"],
    "uk-thr": ["exports", "regulation"],
}


def public(document):
    return {
        ("id" if key == "_id" else key): value
        for key, value in document.items()
        if key
        not in {"owner_id", "busy_until", "lease_token", "input_hash", "mutation_token"}
    }


async def audit(store, event, user_id=None, **fields):
    await store.insert(
        "audit_events",
        {
            "_id": str(uuid4()),
            "event": event,
            "user_id": user_id,
            "created_at": now(),
            "expires_at": now() + timedelta(days=90),
            **fields,
        },
    )


async def limit(request, store, category, maximum, seconds=60):
    # Hash IPs; do not trust spoofable X-Forwarded-For on the native demo server.
    key = digest(f"{category}:{request.client.host if request.client else 'unknown'}")
    if not await store.rate_limit(key, maximum, seconds):
        raise HTTPException(429, "Too many requests. Please try again later.")


async def owned(store, consultation_id, user):
    document = await store.get(
        "consultations", {"_id": consultation_id, "owner_id": user["_id"]}
    )
    if not document:
        raise HTTPException(404, "Consultation not found.")
    return document


async def full_consultation(store, document):
    messages = await store.find(
        "messages",
        {"consultation_id": document["_id"], "owner_id": document["owner_id"]},
        sort=[("created_at", 1), ("role", -1), ("_id", 1)],
        limit=0,
    )
    return {**public(document), "messages": [public(m) for m in messages]}


@router.get("/consultations")
async def consultations(user=Depends(authenticate), store=Depends(store_for)):
    # Ponytail: 500 consultations per account in the hackathon UI; add cursor pagination before broad deployment.
    return [
        public(c)
        for c in await store.find(
            "consultations", {"owner_id": user["_id"]}, sort=[("updated_at", -1)]
        )
    ]


@router.post("/consultations", status_code=201)
async def create(
    body: ConsultationInput, user=Depends(authenticate), store=Depends(store_for)
):
    document = {
        "_id": str(uuid4()),
        "owner_id": user["_id"],
        "title": body.title,
        "created_at": now(),
        "updated_at": now(),
        "facts": {},
        "assessments": {},
    }
    async with store.transaction() as tx:
        await touch_user(tx, user)
        await tx.insert("consultations", document)
    return {**public(document), "messages": []}


@router.get("/consultations/{consultation_id}")
@router.get("/consultations/{consultation_id}/export")
async def get_consultation(
    consultation_id: str, user=Depends(authenticate), store=Depends(store_for)
):
    return await full_consultation(store, await owned(store, consultation_id, user))


@router.get("/consultations/{consultation_id}/messages")
async def get_messages(
    consultation_id: str, user=Depends(authenticate), store=Depends(store_for)
):
    result = await full_consultation(store, await owned(store, consultation_id, user))
    return result["messages"]


@router.patch("/consultations/{consultation_id}")
async def rename(
    consultation_id: str,
    body: ConsultationInput,
    user=Depends(authenticate),
    store=Depends(store_for),
):
    async with store.transaction() as tx:
        await touch_user(tx, user)
        result = await tx.update(
            "consultations",
            {"_id": consultation_id, "owner_id": user["_id"]},
            {"title": body.title, "updated_at": now()},
        )
        if not result.matched_count:
            raise HTTPException(404, "Consultation not found.")
    return {"ok": True}


async def erase_consultation(store, consultation_id, user):
    await owned(store, consultation_id, user)
    if not await store.lease(consultation_id, user["_id"]):
        raise HTTPException(
            409, "Wait for the active response to finish before deleting."
        )
    for collection in ["messages", "runs", "feedback"]:
        await store.delete(
            collection, {"consultation_id": consultation_id, "owner_id": user["_id"]}
        )
    await store.delete(
        "consultations", {"_id": consultation_id, "owner_id": user["_id"]}
    )


@router.delete("/consultations/{consultation_id}")
async def delete_consultation(
    consultation_id: str, user=Depends(authenticate), store=Depends(store_for)
):
    async with store.transaction() as tx:
        await touch_user(tx, user)
        await erase_consultation(tx, consultation_id, user)
        await audit(tx, "consultation_deleted", user["_id"])
    return {"ok": True}


@router.get("/auth/export")
async def export_account(user=Depends(authenticate), store=Depends(store_for)):
    # Ponytail: synchronous in-memory export fits the hackathon; large accounts need a background export job.
    documents = await store.find(
        "consultations", {"owner_id": user["_id"]}, limit=0, sort=[("updated_at", -1)]
    )
    return {
        "user": public_user(user),
        "consultations": [await full_consultation(store, doc) for doc in documents],
    }


@router.delete("/auth/account")
async def delete_account(user=Depends(authenticate), store=Depends(store_for)):
    async with store.transaction() as tx:
        await touch_user(tx, user)
        busy = await tx.get(
            "consultations", {"owner_id": user["_id"], "busy_until": {"$gt": now()}}
        )
        if busy:
            raise HTTPException(
                409,
                "Wait for active consultations to finish before deleting your account.",
            )
        for collection in ["consultations", "messages", "runs", "feedback"]:
            await tx.delete(collection, {"owner_id": user["_id"]})
        for collection in ["audit_events", "connector_grants"]:
            await tx.delete(collection, {"user_id": user["_id"]})
        await tx.delete("users", {"_id": user["_id"]})
    return {"ok": True}


async def submit_message(consultation_id, body, request, user, store, on_event=None):
    await owned(store, consultation_id, user)
    response_id = f"{consultation_id}:{body.request_id}:assistant"
    input_hash = digest(f"{body.scope}:{body.language}:{body.content}")
    existing = await store.get("messages", {"_id": response_id})
    if existing:
        if existing["input_hash"] != input_hash:
            raise HTTPException(409, "Request ID was already used for different input.")
        return await full_consultation(store, await owned(store, consultation_id, user))
    await limit(request, store, "consultation", 20, 3600)
    lease = await store.lease(consultation_id, user["_id"])
    if not lease:
        raise HTTPException(
            409, "A response is already being prepared for this consultation."
        )
    started = time.monotonic()
    try:
        document = await owned(store, consultation_id, user)
        existing = await store.get("messages", {"_id": response_id})
        if existing:
            if existing["input_hash"] != input_hash:
                raise HTTPException(
                    409, "Request ID was already used for different input."
                )
            return await full_consultation(store, document)
        history = await store.find(
            "messages",
            {
                "consultation_id": consultation_id,
                "owner_id": user["_id"],
                "scope": body.scope,
            },
            sort=[("created_at", -1), ("role", 1), ("_id", -1)],
            limit=12,
        )
        history.reverse()
        workflow = request.app.state.workflow or ConsultationWorkflow(
            store, request.app.state.llm, request.app.state.settings
        )
        try:
            async with asyncio.timeout(150):
                options = {"on_event": on_event} if on_event else {}
                answer, trace = await workflow.run(
                    body.content,
                    body.scope,
                    body.language,
                    history,
                    document["facts"],
                    **options,
                )
        except TimeoutError:
            raise HTTPException(
                504, "The response took too long. Please try again."
            ) from None
        run_record = {
            "_id": str(uuid4()),
            "consultation_id": consultation_id,
            "owner_id": user["_id"],
            "scope": body.scope,
            "request_id": body.request_id,
            "model": request.app.state.settings.gemini_model,
            "elapsed_ms": round((time.monotonic() - started) * 1000),
            "status": answer["status"],
            "expires_at": now() + timedelta(days=30),
            **trace,
        }
        if answer["status"] == "error" or trace.get("error_type"):
            # An outage is retryable, not a saved legal abstention. Keep the user's draft and request ID.
            async with store.transaction() as tx:
                await touch_user(tx, user)
                await tx.insert("runs", run_record)
            raise HTTPException(503, answer["short_answer"])
        # BSON stores milliseconds; keep each question before its answer even on a fast retry.
        created = max(now(), document["updated_at"] + timedelta(milliseconds=1))
        answered = created + timedelta(milliseconds=1)
        user_message = {
            "_id": f"{consultation_id}:{body.request_id}:user",
            "consultation_id": consultation_id,
            "owner_id": user["_id"],
            "role": "user",
            "scope": body.scope,
            "content": body.content,
            "created_at": created,
            "request_id": body.request_id,
        }
        assessments = {**document["assessments"], body.scope: answer["context"]}
        facts = {
            **document["facts"],
            **{
                k: v
                for k, v in answer["context"].items()
                if k in (*USER_FACT_FIELDS, "ingredients")
            },
        }
        async with store.transaction() as tx:
            await touch_user(tx, user)
            result = await tx.update(
                "consultations",
                {
                    "_id": consultation_id,
                    "owner_id": user["_id"],
                    "lease_token": lease,
                    "busy_until": {"$gt": now()},
                },
                {"assessments": assessments, "facts": facts, "updated_at": answered},
            )
            if not result.matched_count:
                raise HTTPException(
                    409,
                    "The consultation changed while preparing a response. Please try again.",
                )
            await tx.insert("messages", user_message)
            await tx.insert(
                "messages",
                {
                    "_id": response_id,
                    "consultation_id": consultation_id,
                    "owner_id": user["_id"],
                    "role": "assistant",
                    "scope": body.scope,
                    "answer": answer,
                    "created_at": answered,
                    "request_id": body.request_id,
                    "input_hash": input_hash,
                },
            )
            await tx.insert(
                "runs",
                run_record,
            )
        return await full_consultation(store, await owned(store, consultation_id, user))
    finally:
        await store.release(consultation_id, lease)


@router.post("/consultations/{consultation_id}/messages")
async def message(
    consultation_id: str,
    body: MessageInput,
    request: Request,
    user=Depends(authenticate),
    store=Depends(store_for),
):
    return await submit_message(consultation_id, body, request, user, store)


@router.post("/consultations/{consultation_id}/messages/stream")
async def stream_message(
    consultation_id: str,
    body: MessageInput,
    request: Request,
    user=Depends(authenticate),
    store=Depends(store_for),
):
    await owned(store, consultation_id, user)

    return event_response(body.request_id, lambda emit: submit_message(
        consultation_id, body, request, user, store, emit
    ))


@router.post("/demo/messages/stream")
async def demo_message(body: DemoMessageInput, request: Request, store=Depends(store_for)):
    await limit(request, store, "guest_consultation", 10, 3600)

    async def run(emit):
        history = [item.model_dump() for item in body.history if item.scope == body.scope]
        workflow = request.app.state.workflow or ConsultationWorkflow(
            store, request.app.state.demo_llm, request.app.state.settings
        )
        answer, _ = await workflow.run(body.content, body.scope, body.language, history, {}, on_event=emit)
        if answer["status"] == "error":
            raise HTTPException(503, answer["short_answer"])
        # No consultations, messages, feedback or run records are persisted for guests.
        return {"answer": answer}

    return event_response(body.request_id, run)


def event_response(request_id, operation):

    async def events():
        queue = asyncio.Queue(maxsize=32)

        async def emit(data):
            await queue.put(("progress", data))

        async def work():
            try:
                result = await operation(emit)
                await queue.put(("result", result))
            except HTTPException as exc:
                await queue.put(
                    ("error", {"detail": exc.detail, "status": exc.status_code})
                )
            except Exception:
                await queue.put(
                    (
                        "error",
                        {
                            "detail": "The request could not be completed. Please retry.",
                            "status": 500,
                        },
                    )
                )

        task = asyncio.create_task(work())
        sequence = 0
        try:
            while True:
                try:
                    event, payload = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                sequence += 1
                data = json.dumps(
                    payload, ensure_ascii=False, default=lambda value: value.isoformat()
                )
                yield f"id: {request_id}.{sequence}\nevent: {event}\ndata: {data}\n\n"
                if event in {"result", "error"}:
                    break
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


async def active_source_records(store):
    documents = await store.find("documents", {"active_version": {"$ne": None}}, limit=0)
    versions = await store.find(
        "document_versions",
        {"_id": {"$in": [document["active_version"] for document in documents]}, "reviewed": True},
        limit=0,
    )
    directory = {source["id"]: source for source in CATALOG}
    records = []
    for version in versions:
        source = directory.get(version["source_id"], {})
        review = version["review"]
        reviewed_at = version.get("reviewed_at")
        records.append({
            "id": version["document_id"],
            "source_id": version["source_id"],
            "version_id": version["_id"],
            "title": version["title"],
            "authority": version["authority"],
            "scope": version["scope"],
            "type": "Statute" if review["legal_status"] == "in_force" else "Official guidance",
            "locator": version["base_locator"],
            "url": version["url"],
            "topics": SOURCE_TOPICS.get(version["document_id"], source.get("topics", [])),
            "summary": source.get("summary", "Reviewed official evidence available to the research assistant."),
            "summary_hi": source.get("summary_hi", "शोध सहायक के लिए समीक्षित आधिकारिक साक्ष्य उपलब्ध है।"),
            "checked_at": reviewed_at.date().isoformat() if hasattr(reviewed_at, "date") else reviewed_at,
            "review_type": review["review_type"],
            "legal_status": review["legal_status"],
            "chunk_count": version["chunk_count"],
        })
    return sorted(records, key=lambda record: (record["scope"], record["title"]))


@router.get("/sources")
async def sources(request: Request):
    # The live library exposes only reviewed, active, retrievable document versions.
    return await active_source_records(request.app.state.store) if request.app.state.store else []


@router.get("/sources/coverage")
async def source_coverage(request: Request):
    records = await active_source_records(request.app.state.store) if request.app.state.store else []
    return {
        "checked_at": now(), "active_documents": len(records),
        "active_chunks": sum(record["chunk_count"] for record in records),
        "documents": sorted(records, key=lambda record: (record["scope"], record["id"])),
        "limitation": "These are active reviewed documents, not a claim of exhaustive legal coverage.",
    }


@router.get("/documents/{document_id}")
async def document(document_id: str, request: Request):
    store = store_for(request)
    source = next((source for source in await active_source_records(store) if source["id"] == document_id), None)
    if source:
        return source
    chunk = await store.get(
        "chunks", {"_id": document_id, "access": "public", "reviewed": True}
    )
    if not chunk:
        raise HTTPException(404, "Document not found.")
    fields = {
        "_id",
        "source_id",
        "document_id",
        "version_id",
        "title",
        "authority",
        "scope",
        "url",
        "locator",
        "content",
        "published_at",
        "retrieved_at",
        "reviewed_at",
        "review_type",
        "effective_from",
        "effective_until",
        "legal_status",
        "active",
    }
    return public({key: value for key, value in chunk.items() if key in fields})


@router.get("/knowledge")
async def knowledge():
    return {
        "topics": sorted({topic for source in CATALOG for topic in source["topics"]}),
        "sources": CATALOG,
        "coverage": "Authority directory; live evidence requires reviewed ingestion.",
    }


@router.post("/feedback")
async def feedback(
    body: FeedbackInput, user=Depends(authenticate), store=Depends(store_for)
):
    async with store.transaction() as tx:
        await touch_user(tx, user)
        message = await tx.get(
            "messages",
            {"_id": body.message_id, "owner_id": user["_id"], "role": "assistant"},
        )
        if not message:
            raise HTTPException(404, "Answer not found.")
        await owned(tx, message["consultation_id"], user)
        await tx.insert(
            "feedback",
            {
                "_id": str(uuid4()),
                "owner_id": user["_id"],
                "consultation_id": message["consultation_id"],
                "created_at": now(),
                **body.model_dump(),
            },
        )
    return {"ok": True}


@router.get("/speech/status")
async def speech_status(request: Request, user=Depends(authenticate)):
    s = request.app.state.settings
    return {
        "available": bool(s.bhashini_api_key and s.bhashini_url),
        "asr": bool(s.bhashini_asr_service),
        "tts": bool(s.bhashini_tts_service),
        "translation": bool(s.bhashini_translation_service),
    }


@router.post("/speech")
async def speech_request(
    body: SpeechInput,
    request: Request,
    user=Depends(authenticate),
    store=Depends(store_for),
):
    await limit(request, store, "speech", 20, 3600)
    try:
        return await speech(request.app.state.settings, body)
    except ValueError:
        raise HTTPException(422, "Invalid audio or text input.") from None
    except Exception:
        raise HTTPException(
            503, "Speech service is unavailable. Continue with text."
        ) from None
