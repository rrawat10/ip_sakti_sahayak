"""Local browser-test server only. Never use this module for deployment."""

import asyncio
from app.config import Settings
from app.main import create_app
from app.workflow import ConsultationWorkflow
from test_rag import Provider, evidence_store


class SlowProvider(Provider):
    async def structured(self, *args):
        await asyncio.sleep(0.2)
        return await super().structured(*args)


settings = Settings(
    _env_file=None,
    app_env="test",
    mongodb_uri="",
    gemini_api_key="",
    langsmith_tracing=False,
    app_origin="http://127.0.0.1:5174",
    data_dir="data/e2e",
)
store = evidence_store()
store.data["users"] = [{
    "_id": "browser-user",
    "name": "Browser Researcher",
    "email": "browser@example.com",
}]
app = create_app(settings, store, ConsultationWorkflow(store, SlowProvider(), settings))
