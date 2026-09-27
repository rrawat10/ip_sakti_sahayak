from contextlib import contextmanager
import pytest
from app.config import Settings
from app.observability import Observer
import app.observability as observability


def test_traces_hide_content_by_default_and_redact_exception_text(monkeypatch):
    calls = {}

    class Client:
        def __init__(self, **options):
            calls["options"] = options

    class Run:
        def end(self, **values):
            calls["end"] = values

    @contextmanager
    def context(**kwargs):
        yield

    @contextmanager
    def trace(*args, **kwargs):
        try:
            yield Run()
        except BaseException:
            calls["raw_exception_exported"] = True
            raise

    monkeypatch.setattr(observability.ls, "Client", Client)
    monkeypatch.setattr(observability.ls, "tracing_context", context)
    monkeypatch.setattr(observability.ls, "trace", trace)
    observer = Observer(
        Settings(_env_file=None, langsmith_tracing=True, langsmith_api_key="test-only")
    )
    assert calls["options"]["hide_inputs"] and calls["options"]["hide_outputs"]
    with pytest.raises(ValueError, match="private formulation"):
        with observer.span("test", {}, {"question": "private formulation"}):
            raise ValueError("private formulation")
    assert calls["end"] == {"error": "ValueError"}
    assert "raw_exception_exported" not in calls


def test_disabled_tracing_never_constructs_a_remote_client(monkeypatch):
    def forbidden(**kwargs):
        raise AssertionError("Remote client must not be constructed")

    monkeypatch.setattr(observability.ls, "Client", forbidden)
    observer = Observer(
        Settings(_env_file=None, langsmith_tracing=False, langsmith_api_key="")
    )
    assert observer.client is None
