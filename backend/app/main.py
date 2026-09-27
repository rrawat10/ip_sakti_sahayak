import json
import logging
import mimetypes
import time
from contextlib import asynccontextmanager
from uuid import uuid4
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from .api import router
from .connectors import router as connector_router
from .config import Settings, ROOT
from .repositories import MongoStore
from .providers import Gemini
from clerk_backend_api import Clerk

logger = logging.getLogger("ip_sakti")


def create_app(settings=None, store=None, workflow=None):
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        if app.state.store is None and settings.mongodb_uri:
            app.state.store = MongoStore(
                settings.mongodb_uri, settings.mongodb_database
            )
        try:
            if app.state.store is not None:
                await app.state.store.setup()
            yield
        finally:
            try:
                if app.state.store is not None:
                    await app.state.store.close()
            finally:
                await app.state.llm.close()
                await app.state.demo_llm.close()

    app = FastAPI(
        title="IP-SAKTI Sahayak",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.settings, app.state.store, app.state.workflow = settings, store, workflow
    app.state.clerk = (
        Clerk(bearer_auth=settings.clerk_secret_key)
        if settings.clerk_secret_key
        else None
    )
    app.state.connectors = {}
    app.state.llm = Gemini(settings)
    app.state.demo_llm = Gemini(settings.model_copy(update={"langsmith_tracing": False}))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.app_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def boundaries(request: Request, call_next):
        request_id = str(uuid4())
        started = time.monotonic()
        if request.method in {
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
        } and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if origin != settings.app_origin:
                return JSONResponse(
                    {"detail": "Request origin is not allowed."}, status_code=403
                )
            if (
                request.method != "DELETE"
                and request.headers.get("content-type", "").split(";")[0]
                != "application/json"
            ):
                return JSONResponse(
                    {"detail": "Expected application/json."}, status_code=415
                )
            length = request.headers.get("content-length", "0")
            try:
                too_large = int(length) > 8_000_000
            except ValueError:
                too_large = True
            if too_large:
                return JSONResponse(
                    {"detail": "Request is too large."}, status_code=413
                )
            # Bound chunked bodies too; Content-Length is only an early rejection hint.
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > 8_000_000:
                    return JSONResponse(
                        {"detail": "Request is too large."}, status_code=413
                    )
                chunks.append(chunk)
            request._body = b"".join(chunks)
        try:
            response = await call_next(request)
        except Exception as exc:
            logger.error(
                json.dumps({"request_id": request_id, "error_type": type(exc).__name__})
            )
            response = JSONResponse(
                {"detail": "The request could not be completed. Please try again."},
                status_code=500,
            )
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = (
            "microphone=(self), camera=(), geolocation=()"
        )
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' https:; style-src 'self' 'unsafe-inline'; font-src 'self' https: data:; img-src 'self' data: https://img.clerk.com; connect-src 'self' https:; frame-src https://challenges.cloudflare.com https://*.clerk.com https://*.clerk.accounts.dev; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        if settings.app_env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        logger.info(
            json.dumps(
                {
                    "request_id": request_id,
                    "method": request.method,
                    "status": response.status_code,
                    "elapsed_ms": round((time.monotonic() - started) * 1000),
                }
            )
        )
        return response

    @app.get("/api/health/live")
    async def live():
        return {"status": "ok"}

    @app.get("/api/health/ready")
    async def ready():
        if app.state.store is None:
            return JSONResponse(
                {"status": "not_ready", "database": "not_configured"}, status_code=503
            )
        try:
            await app.state.store.get("users", {"_id": "health-probe"})
        except Exception:
            return JSONResponse(
                {"status": "not_ready", "database": "unavailable"}, status_code=503
            )
        return {
            "status": "ready",
            "generation_configured": bool(settings.gemini_api_key),
        }

    app.include_router(connector_router)
    app.include_router(router)
    dist = ROOT / "frontend/dist"
    if dist.exists():
        # Windows registry MIME associations can omit or misidentify WOFF2 files.
        mimetypes.add_type("font/woff2", ".woff2")
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
        if (dist / "fonts").is_dir():
            app.mount("/fonts", StaticFiles(directory=dist / "fonts"), name="fonts")
        if (dist / "benchmarks").is_dir():
            app.mount(
                "/benchmarks",
                StaticFiles(directory=dist / "benchmarks"),
                name="benchmarks",
            )

        @app.get("/{path:path}")
        async def frontend(path: str):
            if path.startswith("api/"):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            allowed = {"favicon.svg", "mockServiceWorker.js"}
            return FileResponse(
                dist / path
                if path in allowed and (dist / path).exists()
                else dist / "index.html"
            )

    return app


app = create_app()
