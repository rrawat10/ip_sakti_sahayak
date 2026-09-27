import hashlib
import secrets
from fastapi import Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError
from clerk_backend_api.security.types import AuthenticateRequestOptions
from .repositories import now


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def store_for(request: Request):
    if request.app.state.store is None:
        raise HTTPException(
            503,
            "MongoDB is not configured. Set MONGODB_URI in the root .env and restart the API.",
        )
    return request.app.state.store


async def authenticate(request: Request, store=Depends(store_for)):
    settings = request.app.state.settings
    authorization = request.headers.get("authorization", "")
    if settings.app_env == "test" and authorization.startswith("Bearer test:"):
        user = await store.get("users", {"_id": authorization.removeprefix("Bearer test:")})
        if user:
            return user
        raise HTTPException(401, "Please sign in to continue.")
    if settings.app_env == "test":
        raise HTTPException(401, "Please sign in to continue.")
    if request.app.state.clerk is None:
        raise HTTPException(503, "Clerk authentication is not configured.")
    state = await request.app.state.clerk.authenticate_request_async(
        request,
        AuthenticateRequestOptions(
            secret_key=settings.clerk_secret_key or None,
            jwt_key=settings.clerk_jwt_key.replace("\\n", "\n") or None,
            authorized_parties=[settings.app_origin],
        ),
    )
    if not state.is_authenticated or not state.payload or not state.payload.get("sub"):
        raise HTTPException(401, "Please sign in to continue.")
    user_id = state.payload["sub"]
    user = await store.get("users", {"_id": user_id})
    if user:
        return user
    user = {
        "_id": user_id,
        "name": state.payload.get("name") or "Researcher",
        "email": state.payload.get("email") or "",
        "created_at": now(),
    }
    try:
        await store.insert("users", user)
    except DuplicateKeyError:
        user = await store.get("users", {"_id": user_id})
    return user


async def touch_user(store, user):
    result = await store.update(
        "users", {"_id": user["_id"]}, {"mutation_token": secrets.token_hex(16)}
    )
    if not result.matched_count:
        raise HTTPException(401, "Please sign in to continue.")


def public_user(user):
    return {
        "id": user["_id"],
        "name": user.get("name", "Researcher"),
        "email": user.get("email", ""),
    }
