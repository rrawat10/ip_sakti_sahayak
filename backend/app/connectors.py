"""Consent boundary for registered paid-source adapters. No provider is enabled by default."""

from datetime import timedelta
from typing import Protocol
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict, StrictBool
from .repositories import now
from .schemas import Scope
from .security import authenticate, store_for, touch_user

router = APIRouter(prefix="/api/v1/connectors", tags=["connectors"])


class PaidSource(Protocol):
    name: str
    scopes: list[str]

    async def search(self, query: str, scope: str) -> list[dict]: ...


class GrantInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = Field(pattern=r"^[a-z0-9-]{1,60}$")
    scope: Scope
    purpose: str = Field(min_length=5, max_length=250)
    duration_minutes: int = Field(default=30, ge=1, le=1440)
    permission_confirmed: StrictBool


class SearchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    grant_id: str = Field(max_length=100)
    query: str = Field(min_length=1, max_length=1000)


async def event(store, user_id, kind, grant_id, provider):
    await store.insert(
        "audit_events",
        {
            "_id": str(uuid4()),
            "user_id": user_id,
            "event": kind,
            "grant_id": grant_id,
            "provider": provider,
            "created_at": now(),
            "expires_at": now() + timedelta(days=90),
        },
    )


def adapter(request, provider):
    value = request.app.state.connectors.get(provider)
    if value is None:
        raise HTTPException(503, "This subscription provider is not connected.")
    return value


@router.get("")
async def available(request: Request, user=Depends(authenticate)):
    return {
        "connectors": [
            {"id": key, "name": value.name, "scopes": value.scopes}
            for key, value in request.app.state.connectors.items()
        ],
        "detail": "Only providers with an authorized integration appear here. No restricted database is searched without a valid grant.",
    }


@router.post("/grants", status_code=201)
async def grant(
    body: GrantInput,
    request: Request,
    user=Depends(authenticate),
    store=Depends(store_for),
):
    provider = adapter(request, body.provider)
    if not body.permission_confirmed:
        raise HTTPException(422, "Explicit permission is required for this access.")
    if body.scope not in provider.scopes:
        raise HTTPException(
            422, "This provider does not support the selected jurisdiction."
        )
    document = {
        "_id": str(uuid4()),
        "user_id": user["_id"],
        "provider": body.provider,
        "scope": body.scope,
        "purpose": body.purpose,
        "created_at": now(),
        "expires_at": now() + timedelta(minutes=body.duration_minutes),
        "revoked": False,
    }
    async with store.transaction() as tx:
        await touch_user(tx, user)
        await tx.insert("connector_grants", document)
        await event(
            tx,
            user["_id"],
            "connector_permission_granted",
            document["_id"],
            body.provider,
        )
    return {
        "id": document["_id"],
        "provider": body.provider,
        "scope": body.scope,
        "expires_at": document["expires_at"],
    }


@router.get("/grants")
async def grants(user=Depends(authenticate), store=Depends(store_for)):
    documents = await store.find("connector_grants", {"user_id": user["_id"]})
    return [
        {
            ("id" if key == "_id" else key): value
            for key, value in doc.items()
            if key != "user_id"
        }
        for doc in documents
    ]


@router.delete("/grants/{grant_id}")
async def revoke(grant_id: str, user=Depends(authenticate), store=Depends(store_for)):
    grant = await store.get(
        "connector_grants", {"_id": grant_id, "user_id": user["_id"]}
    )
    if not grant:
        raise HTTPException(404, "Permission grant not found.")
    async with store.transaction() as tx:
        await touch_user(tx, user)
        await tx.update(
            "connector_grants",
            {"_id": grant_id, "user_id": user["_id"]},
            {"revoked": True},
        )
        await event(
            tx, user["_id"], "connector_permission_revoked", grant_id, grant["provider"]
        )
    return {"ok": True}


@router.post("/search")
async def search(
    body: SearchInput,
    request: Request,
    user=Depends(authenticate),
    store=Depends(store_for),
):
    grant = await store.get(
        "connector_grants",
        {
            "_id": body.grant_id,
            "user_id": user["_id"],
            "revoked": False,
            "expires_at": {"$gt": now()},
        },
    )
    if not grant:
        raise HTTPException(403, "Permission is missing, expired or revoked.")
    provider = adapter(request, grant["provider"])
    if not await store.rate_limit(f"connector:{user['_id']}", 20, 3600):
        raise HTTPException(429, "Connector request limit reached.")
    await event(
        store, user["_id"], "connector_access_started", grant["_id"], grant["provider"]
    )
    try:
        import asyncio

        records = await asyncio.wait_for(
            provider.search(body.query, grant["scope"]), timeout=30
        )
    except Exception:
        await event(
            store,
            user["_id"],
            "connector_access_failed",
            grant["_id"],
            grant["provider"],
        )
        raise HTTPException(503, "The source provider is unavailable.") from None
    still_valid = await store.get(
        "connector_grants",
        {
            "_id": grant["_id"],
            "user_id": user["_id"],
            "revoked": False,
            "expires_at": {"$gt": now()},
        },
    )
    if not still_valid:
        raise HTTPException(403, "Permission ended before results were available.")
    await event(
        store,
        user["_id"],
        "connector_access_completed",
        grant["_id"],
        grant["provider"],
    )
    return {"provider": grant["provider"], "scope": grant["scope"], "records": records}
