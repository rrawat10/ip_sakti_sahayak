"""Resumable, hash-bound imports using the same review gates as single imports."""

import json
import re
from pathlib import Path
from urllib.parse import urlparse

from .pipeline import Review, activate, fetch_source, ingest, sha256, validate_url


def prepare_manifest(path, root, catalog, policies):
    entries = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(entries, list) or not 1 <= len(entries) <= 100:
        raise ValueError("Manifest must contain between 1 and 100 documents")
    prepared, seen = [], set()
    sources = {source["id"]: source for source in catalog}
    for entry in entries:
        if entry["document"] in seen:
            raise ValueError("Duplicate document in manifest")
        seen.add(entry["document"])
        source = sources[entry["source"]]
        config = {**source, **policies["default"], **policies.get(source["id"], {})}
        config.setdefault("allowed_hosts", [urlparse(source["url"]).hostname])
        validate_url(entry["url"], config["allowed_hosts"])
        config.update(url=entry["url"], title=entry["title"])
        if "html_selector" in entry:
            config["html_selector"] = entry["html_selector"]
        file = (root / entry["file"]).resolve()
        if not file.is_relative_to(root.resolve()):
            raise ValueError("Import file must stay inside the workspace")
        data = file.read_bytes()
        if not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"]) or sha256(data) != entry["sha256"]:
            raise ValueError("Source changed since review; review the new hash")
        mime = {".pdf": "application/pdf", ".html": "text/html", ".txt": "text/plain"}[file.suffix]
        review = Review.model_validate(entry["review"]).model_dump(mode="json") if entry.get("review") else None
        prepared.append((entry, config, data, mime, review))
    return prepared


async def import_manifest(store, llm, settings, prepared, activate_reviewed=False, refresh=False):
    if refresh and activate_reviewed:
        raise ValueError("Updated content requires a new review before activation")
    results = []
    for entry, config, data, mime, review in prepared:
        result = {"document": entry["document"], "source": entry["source"]}
        try:
            if refresh:
                data, mime = await fetch_source(config)
            imported = await ingest(store, settings, config, entry["document"], data, mime, entry["locator"])
            result.update(imported)
            document = await store.get("documents", {"_id": entry["document"]})
            if activate_reviewed and review and imported["reviewed"]:
                version = await store.get("document_versions", {"_id": imported["version_id"]})
                if version.get("review") != review:
                    raise ValueError("Version review is immutable")
            if activate_reviewed and review and document.get("active_version") != imported["version_id"]:
                await activate(store, llm, settings, imported["version_id"], review)
            document = await store.get("documents", {"_id": entry["document"]})
            result["status"] = "active" if document.get("active_version") == imported["version_id"] else "pending_review"
            result["reviewed"] = bool(imported["reviewed"] or result["status"] == "active")
        except Exception as exc:
            # Never include connection strings or provider responses in a report.
            result.update(status="failed", error=type(exc).__name__)
        results.append(result)
        print(json.dumps(result), flush=True)
    return results
