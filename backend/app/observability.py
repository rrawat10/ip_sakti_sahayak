"""Opt-in, redacted LangSmith traces plus request-local usage counters."""

from contextlib import contextmanager
from contextvars import ContextVar
import langsmith as ls

usage = ContextVar("rag_usage", default=None)


class Observer:
    def __init__(self, settings):
        self.settings = settings
        self.client = None
        if settings.langsmith_tracing and settings.langsmith_api_key:
            self.client = ls.Client(
                api_key=settings.langsmith_api_key,
                api_url=settings.langsmith_endpoint,
                hide_inputs=not settings.langsmith_capture_content,
                hide_outputs=not settings.langsmith_capture_content,
                timeout_ms=2000,
            )

    @contextmanager
    def span(self, name, metadata, inputs=None, run_type="chain"):
        """No raw exception messages in remotely exported traces."""
        failure = None
        with ls.tracing_context(
            enabled=bool(self.client),
            client=self.client,
            project_name=self.settings.langsmith_project,
        ):
            with ls.trace(
                name,
                run_type=run_type,
                inputs=inputs or {},
                metadata=metadata,
                client=self.client,
            ) as run:
                try:
                    yield run
                except BaseException as exc:
                    if run:
                        run.end(error=type(exc).__name__)
                    failure = exc
        if failure is not None:
            raise failure

    def close(self):
        if self.client:
            self.client.close(timeout=5)
