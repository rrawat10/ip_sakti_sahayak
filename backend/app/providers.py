import asyncio
import base64
import json
import math
from urllib.parse import urlparse
import httpx
from google import genai
from google.genai import types
from .observability import Observer, usage


class Gemini:
    def __init__(self, settings):
        self.settings = settings
        self.observer = Observer(settings)
        self.client = (
            genai.Client(
                api_key=settings.gemini_api_key,
                http_options=types.HttpOptions(
                    timeout=45000,
                    # Keep transient retries inside the graph's overall deadline.
                    retry_options=types.HttpRetryOptions(
                        attempts=2,
                        initial_delay=0.5,
                        max_delay=2,
                        http_status_codes=[408, 429, 500, 502, 503, 504],
                    ),
                ),
            )
            if settings.gemini_api_key
            else None
        )

    async def structured(self, instructions, payload, schema):
        if not self.client:
            raise RuntimeError("Gemini is not configured")
        with self.observer.span(
            schema.__name__,
            {"ls_provider": "google", "ls_model_name": self.settings.gemini_model},
            payload,
            "llm",
        ) as span:
            response = await self.client.aio.models.generate_content(
                model=self.settings.gemini_model,
                contents=json.dumps(payload, ensure_ascii=False, default=str),
                config=types.GenerateContentConfig(
                    system_instruction=instructions,
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=0.1,
                ),
            )
            metadata = response.usage_metadata
            counts = usage.get()
            input_tokens = (metadata.prompt_token_count or 0) if metadata else 0
            thought_tokens = (metadata.thoughts_token_count or 0) if metadata else 0
            output_tokens = (
                ((metadata.candidates_token_count or 0) + thought_tokens)
                if metadata
                else 0
            )
            if counts is not None:
                counts["generation_calls"] += 1
                counts["input_tokens"] += input_tokens
                counts["output_tokens"] += output_tokens
            if span:
                span.add_metadata(
                    {
                        "usage_metadata": {
                            "input_tokens": input_tokens,
                            "output_tokens": output_tokens,
                            "total_tokens": input_tokens + output_tokens,
                        }
                    }
                )
                span.end(
                    outputs={
                        "usage_metadata": {
                            "input_tokens": input_tokens,
                            "output_tokens": output_tokens,
                            "total_tokens": input_tokens + output_tokens,
                        }
                    }
                )
        return schema.model_validate_json(response.text)

    async def embed(self, text, task_type="RETRIEVAL_DOCUMENT"):
        if not self.client:
            raise RuntimeError("Embedding provider is not configured")
        with self.observer.span(
            "embed", {"model": self.settings.embedding_model, "task_type": task_type}
        ):
            response = await self.client.aio.models.embed_content(
                model=self.settings.embedding_model,
                contents=text,
                config=types.EmbedContentConfig(
                    output_dimensionality=self.settings.embedding_dimensions,
                    task_type=task_type,
                ),
            )
        vector = response.embeddings[0].values
        if len(vector) != self.settings.embedding_dimensions or any(
            not math.isfinite(value) for value in vector
        ):
            raise ValueError("Embedding dimension mismatch")
        norm = math.sqrt(sum(value * value for value in vector))
        if not norm:
            raise ValueError("Embedding has zero magnitude")
        counts = usage.get()
        if counts is not None:
            counts["embedding_calls"] += 1
        return [value / norm for value in vector]

    async def close(self):
        if self.client:
            await self.client.aio.aclose()
        await asyncio.to_thread(self.observer.close)


async def speech(settings, body):
    parsed = urlparse(settings.bhashini_url)
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(
        ".bhashini.gov.in"
    ):
        raise RuntimeError("An approved Bhashini inference endpoint is not configured")
    service = {
        "asr": settings.bhashini_asr_service,
        "tts": settings.bhashini_tts_service,
        "translation": settings.bhashini_translation_service,
    }[body.task]
    if not settings.bhashini_api_key or not service:
        raise RuntimeError("This Bhashini service is not configured")
    config = {"serviceId": service, "language": {"sourceLanguage": body.language}}
    if body.task == "translation":
        config["language"]["targetLanguage"] = body.target_language
    if body.task == "asr":
        raw = base64.b64decode(body.audio, validate=True)
        if not raw or len(raw) > 4_000_000:
            raise ValueError("Audio must be between 1 byte and 4 MB")
        config["audioFormat"] = body.audio_format
        config["samplingRate"] = 16000
        inputs = {"audio": [{"audioContent": body.audio}]}
    else:
        if not body.text.strip():
            raise ValueError("Text is required")
        inputs = {"input": [{"source": body.text}]}
    async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
        response = await client.post(
            settings.bhashini_url,
            headers={"Authorization": settings.bhashini_api_key},
            json={
                "pipelineTasks": [{"taskType": body.task, "config": config}],
                "inputData": inputs,
            },
        )
        response.raise_for_status()
        return response.json()
