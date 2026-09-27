from types import SimpleNamespace
import math
import pytest
from app.config import Settings
from app.providers import Gemini
from app.repositories import MongoStore


@pytest.mark.asyncio
async def test_transient_provider_retries_are_bounded():
    from google.genai import errors
    import httpx

    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(
            503,
            json={
                "error": {
                    "code": 503,
                    "message": "unavailable",
                    "status": "UNAVAILABLE",
                }
            },
        )

    provider = Gemini(
        Settings(_env_file=None, gemini_api_key="test-only", langsmith_tracing=False)
    )
    try:
        # Exercise the installed SDK's actual retry transport without network access.
        from google import genai
        from google.genai import types

        options = provider.client._api_client._http_options.model_copy(
            update={
                "httpx_async_client": httpx.AsyncClient(
                    transport=httpx.MockTransport(respond)
                ),
            }
        )
        await provider.client.aio.aclose()
        provider.client = genai.Client(api_key="test-only", http_options=options)
        with pytest.raises(errors.ServerError):
            await provider.client.aio.models.generate_content(
                model="test",
                contents="probe",
                config=types.GenerateContentConfig(temperature=0),
            )
        assert len(calls) == 2
    finally:
        await provider.close()


@pytest.mark.asyncio
async def test_embedding_configuration_and_normalization():
    settings = Settings(
        _env_file=None,
        gemini_api_key="",
        langsmith_tracing=False,
        embedding_dimensions=128,
    )
    provider = Gemini(settings)
    calls = []

    async def embed_content(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[2.0] * 128)])

    provider.client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(embed_content=embed_content))
    )
    vector = await provider.embed("Question", task_type="RETRIEVAL_QUERY")
    assert math.isclose(sum(value * value for value in vector), 1.0)
    assert calls[0]["config"].task_type == "RETRIEVAL_QUERY"
    assert calls[0]["config"].output_dimensionality == 128


@pytest.mark.asyncio
async def test_search_filters_match_between_lexical_and_vector_branches():
    pipelines = []

    class Cursor:
        async def to_list(self, **kwargs):
            return []

    class Collection:
        async def aggregate(self, pipeline):
            pipelines.append(pipeline)
            return Cursor()

    store = object.__new__(MongoStore)
    store.db = SimpleNamespace(chunks=Collection())
    await store.lexical_search("question", "india", "embedding", 128)
    await store.vector_search([0.1] * 128, "india", "embedding", 128)
    lexical = pipelines[0][0]["$search"]["compound"]["filter"]
    vector = pipelines[1][0]["$vectorSearch"]["filter"]
    reconstructed = {}
    for condition in lexical:
        kind, value = next(iter(condition.items()))
        reconstructed[value["path"]] = (
            {"$in": value["value"]} if kind == "in" else value["value"]
        )
    assert reconstructed == vector
    assert vector["current_reviewed"] is True and vector["access"] == "public"
    assert vector["scope"] == "india" and vector["embedding_dimensions"] == 128
