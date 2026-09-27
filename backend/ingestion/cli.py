import argparse
import asyncio
import json
import re
from pathlib import Path
from urllib.parse import urlparse
from app.config import Settings, ROOT
from app.repositories import MongoStore
from app.providers import Gemini
from .pipeline import fetch_source, ingest, activate, validate_url, link_evidence


async def run(args):
    settings = Settings()
    if not settings.mongodb_uri:
        raise ValueError("Set MONGODB_URI in the root .env before importing sources")
    store = MongoStore(settings.mongodb_uri, settings.mongodb_database)
    llm = Gemini(settings)
    try:
        await store.setup()
        if args.command in {"batch", "refresh"}:
            from .batch import prepare_manifest, import_manifest

            catalog = json.loads((ROOT / "corpus/catalog.json").read_text(encoding="utf-8"))
            policies = json.loads((ROOT / "corpus/source-configs/policies.json").read_text(encoding="utf-8"))
            prepared = prepare_manifest(args.manifest, ROOT, catalog, policies)
            results = await import_manifest(store, llm, settings, prepared, getattr(args, "activate", False), args.command == "refresh")
            report = settings.storage_path / f"{args.command}-report.json"
            report.parent.mkdir(parents=True, exist_ok=True)
            temporary = report.with_suffix(".tmp")
            temporary.write_text(json.dumps(results, indent=2), encoding="utf-8")
            temporary.replace(report)
            if any(result["status"] == "failed" for result in results):
                raise ValueError("Some documents failed; inspect the data directory report and rerun")
            return {"documents": len(results), "report": str(report)}
        if args.command == "status":
            indexes = await (await store.db.chunks.list_search_indexes()).to_list(
                length=None
            )
            return {
                "documents": await store.db.documents.count_documents({}),
                "active_documents": await store.db.documents.count_documents(
                    {"active_version": {"$ne": None}}
                ),
                "pending_versions": await store.db.document_versions.count_documents(
                    {"reviewed": False}
                ),
                "reviewed_chunks": await store.db.chunks.count_documents(
                    {"active": True, "reviewed": True}
                ),
                "indexes": [
                    {
                        "name": item["name"],
                        "status": item.get("status"),
                        "queryable": item.get("queryable", False),
                    }
                    for item in indexes
                ],
            }
        if args.command == "link":
            return await link_evidence(
                store,
                args.from_chunk,
                args.to_chunk,
                args.relation,
                args.reviewer,
                args.note,
            )
        if args.command == "indexes":
            from pymongo.operations import SearchIndexModel

            names = []
            existing = {
                item["name"]
                for item in await (await store.db.chunks.list_search_indexes()).to_list(
                    length=None
                )
            }
            for filename in ["lexical-index.json", "vector-index.json"]:
                spec = json.loads(
                    (ROOT / "corpus/source-configs" / filename).read_text(
                        encoding="utf-8"
                    )
                )
                if filename == "vector-index.json":
                    for field in spec["definition"]["fields"]:
                        if field["type"] == "vector":
                            field["numDimensions"] = settings.embedding_dimensions
                if spec["name"] not in existing:
                    await store.db.chunks.create_search_index(SearchIndexModel(**spec))
                names.append(spec["name"])
            return {
                "indexes": names,
                "note": "Creation is asynchronous. Verify READY status in Atlas before retrieval; existing definitions are not overwritten.",
            }
        if args.command == "activate":
            review = json.loads(Path(args.review).read_text(encoding="utf-8"))
            return await activate(store, llm, settings, args.version, review)
        policies = json.loads(
            (ROOT / "corpus/source-configs/policies.json").read_text(encoding="utf-8")
        )
        catalog = json.loads((ROOT / "corpus/catalog.json").read_text(encoding="utf-8"))
        source = next((s for s in catalog if s["id"] == args.source), None)
        if not source or source.get("restricted"):
            raise ValueError(
                "Unknown or restricted source; only permitted public material may be imported"
            )
        config = {**source, **policies["default"], **policies.get(args.source, {})}
        config.setdefault("allowed_hosts", [urlparse(source["url"]).hostname])
        if args.url:
            validate_url(args.url, config["allowed_hosts"])
            config["url"] = args.url
        if args.title:
            config["title"] = args.title
        if not re.fullmatch(r"[a-z0-9-]{1,100}", args.document):
            raise ValueError(
                "Document ID must contain lowercase letters, digits or hyphens"
            )
        if args.file:
            path = Path(args.file)
            content_type = {
                ".pdf": "application/pdf",
                ".html": "text/html",
                ".txt": "text/plain",
            }.get(path.suffix.lower())
            if not content_type:
                raise ValueError("Import a PDF, HTML or UTF-8 text file")
            data = path.read_bytes()
        else:
            data, content_type = await fetch_source(config)
        return await ingest(
            store, settings, config, args.document, data, content_type, args.locator
        )
    finally:
        await store.close()
        await llm.close()


def main():
    parser = argparse.ArgumentParser(
        description="Import, review and activate authoritative source versions"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("indexes")
    sub.add_parser("status")
    batch = sub.add_parser("batch", help="Import a hash-checked manifest; resumable after failures")
    batch.add_argument("--manifest", required=True)
    batch.add_argument("--activate", action="store_true", help="Activate only entries with explicit hash-bound reviews")
    refresh = sub.add_parser("refresh", help="Fetch permitted updates without replacing reviewed active versions")
    refresh.add_argument("--manifest", required=True)
    link = sub.add_parser("link")
    link.add_argument("--from-chunk", required=True)
    link.add_argument("--to-chunk", required=True)
    link.add_argument(
        "--relation", choices=["defines", "refers_to", "requires"], required=True
    )
    link.add_argument("--reviewer", required=True)
    link.add_argument("--note", required=True)
    imp = sub.add_parser("import")
    imp.add_argument("--source", required=True)
    imp.add_argument("--document", required=True)
    imp.add_argument("--locator", required=True)
    imp.add_argument(
        "--url", help="Exact official document URL within the source allowlist"
    )
    imp.add_argument(
        "--title", help="Exact document title, rather than authority directory title"
    )
    location = imp.add_mutually_exclusive_group(required=True)
    location.add_argument("--file")
    location.add_argument("--fetch", action="store_true")
    review = sub.add_parser("activate")
    review.add_argument("--version", required=True)
    review.add_argument("--review", required=True)
    try:
        print(json.dumps(asyncio.run(run(parser.parse_args())), indent=2, default=str))
    except Exception as exc:
        # Never dump a MongoDB connection string or provider response.
        parser.exit(
            1,
            f"{type(exc).__name__}: import/activation did not finish. Check source policy, review metadata, connection and provider configuration.\n",
        )


if __name__ == "__main__":
    main()
