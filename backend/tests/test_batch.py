import json
from types import SimpleNamespace

import pytest

from ingestion.batch import prepare_manifest, import_manifest
from ingestion.pipeline import sha256
from test_system import MemoryStore


@pytest.mark.asyncio
async def test_hash_bound_batch_resumes_embeddings_without_publishing_partial_evidence(tmp_path, monkeypatch):
    raw = ("Section 1\n" + "Evidence for review. " * 180).encode()
    (tmp_path / "source.txt").write_bytes(raw)
    entry = {
        "source": "official", "document": "doc", "title": "Reviewed guidance",
        "url": "https://example.org/source", "file": "source.txt",
        "sha256": sha256(raw), "locator": "Section 1",
        "review": {"reviewer": "Engineering test", "current_reviewed": True,
                   "locator_verified": True, "legal_status": "official_guidance"},
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps([entry]))
    sources = [{"id": "official", "url": entry["url"], "scope": "india", "authority": "Authority"}]
    policies = {"default": {"permissions_reviewed": True, "allowed_types": ["text/plain"]}}
    prepared = prepare_manifest(path, tmp_path, sources, policies)
    store = MemoryStore()
    settings = SimpleNamespace(storage_path=tmp_path, embedding_dimensions=128, embedding_model="test")

    class Embeddings:
        calls = 0
        fail = True

        async def embed(self, text):
            self.calls += 1
            if self.fail and self.calls == 2:
                raise RuntimeError("private provider response")
            return [1.0] * 128

    llm = Embeddings()
    report = await import_manifest(store, llm, settings, prepared, True)
    assert report[0]["status"] == "failed" and report[0]["error"] == "RuntimeError"
    assert "private" not in json.dumps(report)
    assert store.data["documents"][0]["active_version"] is None
    assert llm.calls == 2
    llm.fail = False
    report = await import_manifest(store, llm, settings, prepared, True)
    assert report[0]["status"] == "active" and llm.calls == 3
    assert all(chunk["active"] for chunk in store.data["chunks"])
    await import_manifest(store, llm, settings, prepared, True)
    assert llm.calls == 3
    active = store.data["documents"][0]["active_version"]
    async def fetched(config):
        return raw + b"Updated document.", "text/plain"
    monkeypatch.setattr("ingestion.batch.fetch_source", fetched)
    updated = await import_manifest(store, llm, settings, prepared, refresh=True)
    assert updated[0]["status"] == "pending_review"
    assert updated[0]["version_id"] != active
    assert store.data["documents"][0]["active_version"] == active
    with pytest.raises(ValueError, match="new review"):
        await import_manifest(store, llm, settings, prepared, True, refresh=True)
    prepared[0][-1]["reviewer"] = "Changed reviewer"
    assert (await import_manifest(store, llm, settings, prepared, True))[0]["status"] == "failed"
    (tmp_path / "source.txt").write_bytes(raw + b"Changed")
    with pytest.raises(ValueError, match="changed since review"):
        prepare_manifest(path, tmp_path, sources, policies)


def test_pdf_broken_characters_require_review(monkeypatch):
    from ingestion import pipeline
    page = SimpleNamespace(extract_text=lambda: "Readable text " * 10 + "\x08broken glyph")
    monkeypatch.setattr(pipeline, "PdfReader", lambda _: SimpleNamespace(is_encrypted=False, pages=[page]))
    with pytest.raises(ValueError, match="broken character mappings"):
        pipeline.extract(b"test", "application/pdf")
    with pytest.raises(ValueError, match="outside the reviewed"):
        pipeline.check_permission({"permissions_reviewed": True, "url": "https://example.org/unreviewed", "allowed_urls": ["https://example.org/reviewed"]})
