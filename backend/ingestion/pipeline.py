"""Explicit source import and review. Nothing is activated merely because it downloaded."""

import asyncio
import hashlib
import io
import ipaddress
import math
import os
import re
import socket
import tempfile
from datetime import date, timedelta
from typing import Literal
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    field_validator,
    model_validator,
)
from pymongo.errors import DuplicateKeyError
from app.repositories import now

MAX_BYTES = 20_000_000
MAX_TEXT_CHARS = 4_000_000
MAX_CHUNKS = 2000


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reviewer: str = Field(min_length=1, max_length=200)
    review_type: Literal["engineering", "qualified"] = "engineering"
    current_reviewed: StrictBool
    locator_verified: StrictBool
    legal_status: Literal["in_force", "official_guidance", "adopted_not_in_force"]
    published_at: date | None = None
    effective_from: date | None = None
    effective_until: date | None = None
    adopted_on: date | None = None
    entered_into_force: date | None = None
    territories: list[str] = Field(default_factory=list, max_length=200)
    review_notes: str = Field(default="", max_length=4000)

    @field_validator(
        "published_at",
        "effective_from",
        "effective_until",
        "adopted_on",
        "entered_into_force",
        mode="before",
    )
    @classmethod
    def date_only(cls, value):
        if value is not None and (
            not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)
        ):
            raise ValueError("Dates must be YYYY-MM-DD strings")
        return value

    @model_validator(mode="after")
    def current(self):
        today = now().date()
        if not self.current_reviewed or not self.locator_verified:
            raise ValueError(
                "Current applicability and locator verification are required"
            )
        if self.legal_status == "in_force" and self.effective_from is None:
            raise ValueError("In-force legislation needs a verified effective date")
        if self.legal_status == "adopted_not_in_force" and (
            not self.adopted_on or self.entered_into_force or self.effective_from
        ):
            raise ValueError(
                "An adopted treaty requires its adoption date and cannot be marked effective"
            )
        if (
            self.adopted_on
            and self.legal_status == "in_force"
            and (not self.entered_into_force or not self.territories)
        ):
            raise ValueError(
                "In-force treaties need entry-into-force and territorial applicability metadata"
            )
        if (
            self.adopted_on
            and self.entered_into_force
            and self.entered_into_force < self.adopted_on
        ):
            raise ValueError("Entry into force cannot precede adoption")
        if any(
            value and value > today
            for value in (
                self.published_at,
                self.effective_from,
                self.adopted_on,
                self.entered_into_force,
            )
        ):
            raise ValueError("Future material cannot be activated")
        if self.effective_until and (
            self.effective_until < today
            or (self.effective_from and self.effective_until < self.effective_from)
        ):
            raise ValueError(
                "Material is no longer applicable or has invalid effective dates"
            )
        return self


def check_permission(config):
    if config.get("restricted") or config.get("permissions_reviewed") is not True:
        raise ValueError(
            "Source permissions must be reviewed; restricted material cannot be imported"
        )
    if config.get("allowed_urls") and config.get("url") not in config["allowed_urls"]:
        raise ValueError("This document URL is outside the reviewed source policy")


def sha256(content):
    return hashlib.sha256(content).hexdigest()


async def link_evidence(store, from_chunk, to_chunk, relation, reviewer, note):
    """A reviewed source cross-reference, not a model-invented graph edge."""
    if (
        relation not in {"defines", "refers_to", "requires"}
        or not reviewer.strip()
        or not note.strip()
    ):
        raise ValueError(
            "A supported relation, reviewer and source-based explanation are required"
        )
    if from_chunk == to_chunk:
        raise ValueError("A cross-reference must connect different chunks")
    chunks = [
        await store.get("chunks", {"_id": key, "reviewed": True, "access": "public"})
        for key in [from_chunk, to_chunk]
    ]
    if not all(chunks) or chunks[0]["scope"] != chunks[1]["scope"]:
        raise ValueError(
            "Both endpoints must be reviewed public evidence in the same scope"
        )
    edge = {
        "_id": sha256(f"{from_chunk}:{to_chunk}:{relation}".encode()),
        "from_chunk": from_chunk,
        "to_chunk": to_chunk,
        "from_version": chunks[0]["version_id"],
        "to_version": chunks[1]["version_id"],
        "scope": chunks[0]["scope"],
        "relation": relation,
        "reviewer": reviewer.strip(),
        "note": note.strip(),
        "reviewed": True,
        "created_at": now(),
    }
    if not await store.get("knowledge_relations", {"_id": edge["_id"]}):
        await store.insert("knowledge_relations", edge)
    return {"id": edge["_id"], "scope": edge["scope"], "relation": relation}


def validate_url(url, allowed_hosts):
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port not in {None, 443}
        or parsed.hostname not in allowed_hosts
    ):
        raise ValueError("URL is outside the approved HTTPS source policy")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(
        not ipaddress.ip_address(item[4][0]).is_global for item in addresses
    ):
        raise ValueError("Source must resolve only to public addresses")
    return addresses[0][4][0]


async def fetch_source(config):
    check_permission(config)
    if config.get("fetch_allowed") is not True:
        raise ValueError(
            "Source is manual-import only. Review terms and crawling policy before enabling fetch."
        )
    url = config["url"]
    address = validate_url(url, config["allowed_hosts"])
    parsed = urlparse(url)
    # Pin the validated address, while preserving TLS verification and HTTP Host.
    pinned = httpx.URL(url).copy_with(host=address, fragment=None)
    extensions = {"sni_hostname": parsed.hostname}
    async with httpx.AsyncClient(
        timeout=30,
        follow_redirects=False,
        trust_env=False,
        headers={"User-Agent": "IP-SAKTI-Research/0.1", "Host": parsed.netloc},
    ) as client:
        async with client.stream(
            "GET",
            pinned.copy_with(path="/robots.txt", query=None),
            extensions=extensions,
        ) as robots:
            if robots.status_code not in {200, 404}:
                raise ValueError("Could not verify robots policy")
            robots_data = bytearray()
            async for part in robots.aiter_bytes(chunk_size=65536):
                robots_data.extend(part)
                if len(robots_data) > 512_000:
                    raise ValueError("Robots policy exceeds size limit")
        delay = 1
        if robots.status_code == 200:
            rules = RobotFileParser()
            rules.parse(robots_data.decode("utf-8", errors="replace").splitlines())
            if not rules.can_fetch("IP-SAKTI-Research", url):
                raise ValueError("Robots policy disallows this URL")
            delay = max(delay, rules.crawl_delay("IP-SAKTI-Research") or 0)
            rate = rules.request_rate("IP-SAKTI-Research")
            if rate and rate.requests:
                delay = max(delay, rate.seconds / rate.requests)
            if delay > 60:
                raise ValueError(
                    "Source crawl delay requires manual import or scheduled fetching"
                )
        await asyncio.sleep(delay)
        async with client.stream("GET", pinned, extensions=extensions) as response:
            response.raise_for_status()
            content_type = (
                response.headers.get("content-type", "").split(";")[0].strip().lower()
            )
            if content_type not in config["allowed_types"]:
                raise ValueError("Unsupported content type")
            data = bytearray()
            async for part in response.aiter_bytes(chunk_size=65536):
                data.extend(part)
                if len(data) > MAX_BYTES:
                    raise ValueError("Source exceeds 20 MB limit")
            return bytes(data), content_type


def extract(data, content_type, html_selector=None):
    if len(data) > MAX_BYTES:
        raise ValueError("Source exceeds 20 MB limit")
    if content_type == "application/pdf":
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted or len(reader.pages) > 1000:
            raise ValueError("Encrypted or oversized PDF requires manual processing")
        pages = []
        total = 0
        for index, page in enumerate(reader.pages):
            content = page.extract_text() or ""
            if re.search(r"[\x00-\x08\x0b\x0e-\x1f\ufffd]", content):
                raise ValueError("PDF text contains broken character mappings; manual extraction review is required")
            total += len(content)
            if total > MAX_TEXT_CHARS:
                raise ValueError("Extracted text exceeds size limit")
            pages.append({"page": index + 1, "content": content})
        if any(len(page["content"].strip()) < 40 for page in pages):
            raise ValueError(
                "PDF has sparse or scanned pages. OCR and manual review are required."
            )
        return pages
    if content_type == "text/html":
        soup = BeautifulSoup(data, "html.parser")
        selected = soup.select_one(html_selector) if html_selector else None
        if html_selector and selected is None:
            raise ValueError(
                "Configured content selector was not found; review the changed page layout"
            )
        for tag in soup(
            ["script", "style", "nav", "footer", "header", "form", "iframe"]
        ):
            tag.decompose()
        body = selected or soup.find("main") or soup.find("article") or soup
        return [{"page": None, "content": body.get_text("\n", strip=True)}]
    if content_type == "text/plain":
        return [{"page": None, "content": data.decode("utf-8-sig")}]
    raise ValueError("Unsupported file type")


def chunk_pages(pages, base_locator, max_chars=2400):
    if (
        not isinstance(base_locator, str)
        or not base_locator.strip()
        or len(base_locator) > 500
    ):
        raise ValueError("A nonempty locator of at most 500 characters is required")
    if not isinstance(max_chars, int) or not 201 <= max_chars <= 10000:
        raise ValueError("Chunk windows must be between 201 and 10000 characters")
    chunks = []
    total = 0
    provision = base_locator.strip()
    for page in pages:
        text = page["content"].strip()
        total += len(text)
        if total > MAX_TEXT_CHARS:
            raise ValueError("Extracted text exceeds size limit")
        if not text:
            continue
        # Keep section headings with their provision. Long provisions keep the same locator.
        sections = re.split(
            r"(?im)(?=^[ \t]*(?:section|article|rule|chapter)\s+(?:\d+[a-z]*|[ivxlcdm]+)\b)",
            text,
        )
        for section in sections:
            if not section.strip():
                continue
            heading = section.strip().splitlines()[0].strip()
            if re.match(r"(?i)^(section|article|rule|chapter)\s", heading):
                provision = heading[:200]
            locator = provision
            if page["page"]:
                locator += f" · PDF page {page['page']}"
            # Ponytail: character windows within a provision; retain overlap until tokenizer-aware evaluation is justified.
            start = 0
            while start < len(section):
                end = min(start + max_chars, len(section))
                chunks.append(
                    {
                        "content": section[start:end],
                        "locator": locator,
                        "page": page["page"],
                        "index": len(chunks),
                    }
                )
                if len(chunks) > MAX_CHUNKS:
                    raise ValueError("Document exceeds the chunk budget")
                if end == len(section):
                    break
                start = end - 200
    if not chunks:
        raise ValueError("No extractable text")
    return chunks


async def ingest(store, settings, config, document_id, data, content_type, locator):
    check_permission(config)
    if not isinstance(document_id, str) or not re.fullmatch(
        r"[a-z0-9-]{1,100}", document_id
    ):
        raise ValueError("Invalid document ID")
    if content_type not in config.get("allowed_types", []):
        raise ValueError("File type is outside source policy")
    content_hash = sha256(data)
    existing = await store.get(
        "document_versions", {"source_id": config["id"], "content_hash": content_hash}
    )
    if existing and existing["document_id"] != document_id:
        raise ValueError("Identical source bytes already belong to another document")
    document = await store.get("documents", {"_id": document_id})
    if document and document["source_id"] != config["id"]:
        raise ValueError("Document belongs to another source")
    pages = extract(data, content_type, config.get("html_selector"))
    chunks = chunk_pages(pages, locator)
    version_id = existing["_id"] if existing else f"{document_id}-{content_hash}"
    directory = settings.storage_path / "corpus"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / content_hash
    # An atomic hard link publishes complete immutable bytes; a failed write cannot poison retries.
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as temporary:
        temporary_path = temporary.name
        try:
            temporary.write(data)
            temporary.flush()
            os.fsync(temporary.fileno())
        except BaseException:
            temporary.close()
            os.unlink(temporary_path)
            raise
    try:
        try:
            os.link(temporary_path, target)
        except FileExistsError:
            if (
                target.stat().st_size != len(data)
                or sha256(target.read_bytes()) != content_hash
            ):
                raise ValueError("Stored source bytes failed integrity verification")
    finally:
        os.unlink(temporary_path)
    if not document:
        try:
            await store.insert(
                "documents",
                {
                    "_id": document_id,
                    "source_id": config["id"],
                    "title": config["title"],
                    "active_version": None,
                },
            )
        except DuplicateKeyError:
            document = await store.get("documents", {"_id": document_id})
            if not document or document["source_id"] != config["id"]:
                raise ValueError("Document belongs to another source")
    # A text hash is a review hint only: layout-only updates still require explicit activation.
    text_hash = sha256(
        "\n".join(" ".join(page["content"].split()) for page in pages).encode("utf-8")
    )
    metadata = {
        "source_id": config["id"],
        "document_id": document_id,
        "content_hash": content_hash,
        "parser": "ip-sakti-v2",
        "chunk_count": len(chunks),
        "content_type": content_type,
        "html_selector": config.get("html_selector"),
        "base_locator": locator,
        "scope": config["scope"],
        "title": config["title"],
        "authority": config["authority"],
        "url": config["url"],
    }
    if not existing:
        try:
            await store.insert(
                "document_versions",
                {
                    "_id": version_id,
                    **metadata,
                    "text_hash": text_hash,
                    "retrieved_at": now(),
                    "reviewed": False,
                    "import_state": "importing",
                },
            )
        except DuplicateKeyError:
            existing = await store.get(
                "document_versions",
                {"source_id": config["id"], "content_hash": content_hash},
            )
            if not existing:
                raise ValueError("Version identity collision")
    if existing and any(existing.get(key) != value for key, value in metadata.items()):
        raise ValueError(
            "Version metadata is immutable; use a new document/source identity for corrections"
        )
    for chunk in chunks:
        record = {
            **chunk,
            "_id": f"{version_id}:{chunk['index']}",
            "document_id": document_id,
            "version_id": version_id,
            "source_id": config["id"],
            "scope": config["scope"],
            "title": config["title"],
            "authority": config["authority"],
            "url": config["url"],
            "access": "public",
        }
        saved = await store.get("chunks", {"_id": record["_id"]})
        if not saved:
            try:
                await store.insert(
                    "chunks",
                    {
                        **record,
                        "active": False,
                        "reviewed": False,
                        "current_reviewed": False,
                        "legal_status": "unknown",
                    },
                )
            except DuplicateKeyError:
                saved = await store.get("chunks", {"_id": record["_id"]})
                if not saved:
                    raise ValueError("Chunk identity collision")
        if saved and any(saved.get(key) != value for key, value in record.items()):
            raise ValueError("Stored chunks differ from immutable source extraction")
    await store.update(
        "document_versions", {"_id": version_id}, {"import_state": "complete"}
    )
    active = (
        await store.get("document_versions", {"_id": document.get("active_version")})
        if document and document.get("active_version")
        else None
    )
    await store.update("documents", {"_id": document_id}, {"last_checked_at": now()})
    return {
        "version_id": version_id,
        "duplicate": bool(existing),
        "chunks": len(chunks),
        "reviewed": bool(existing and existing.get("reviewed")),
        "text_matches_active": bool(active and active.get("text_hash") == text_hash),
    }


async def activate(store, llm, settings, version_id, review):
    version = await store.get("document_versions", {"_id": version_id})
    if not version:
        raise ValueError("Version not found")
    try:
        review = Review.model_validate(review).model_dump(mode="json")
    except ValueError as exc:
        raise ValueError(
            "Reviewer and valid current applicability/locator review metadata are required"
        ) from exc
    if version.get("import_state") != "complete":
        raise ValueError("Import is incomplete; finish importing before activation")
    document = await store.get("documents", {"_id": version["document_id"]})
    if not document or document.get("source_id") != version["source_id"]:
        raise ValueError("Version document/source identity is inconsistent")
    chunks = await store.find(
        "chunks", {"version_id": version_id}, limit=MAX_CHUNKS + 1
    )
    if (
        not chunks
        or len(chunks) != version["chunk_count"]
        or len(chunks) > MAX_CHUNKS
        or {c.get("index") for c in chunks} != set(range(len(chunks)))
    ):
        raise ValueError("Version chunks are incomplete")
    if any(
        c.get("document_id") != version["document_id"]
        or c.get("source_id") != version["source_id"]
        or c.get("access") != "public"
        or not c.get("locator")
        or not c.get("content")
        for c in chunks
    ):
        raise ValueError("Invalid chunk identity or evidence metadata")
    # Reserve one immutable review before any chunk writes; interrupted activation resumes that review.
    if version.get("review") is None:
        await store.update(
            "document_versions", {"_id": version_id, "review": None}, {"review": review}
        )
        version = await store.get("document_versions", {"_id": version_id})
    if version.get("review") != review:
        raise ValueError("Version review is immutable")
    if not version.get("reviewed"):
        async def embed_chunk(chunk):
            if (
                chunk.get("reviewed") is True
                and chunk.get("embedding_model") == settings.embedding_model
                and chunk.get("embedding_dimensions") == settings.embedding_dimensions
                and isinstance(chunk.get("embedding"), list)
                and len(chunk["embedding"]) == settings.embedding_dimensions
                and all(type(v) in (int, float) and math.isfinite(v) for v in chunk["embedding"])
            ):
                return
            vector = await llm.embed(chunk["content"])
            if (
                not isinstance(vector, list)
                or len(vector) != settings.embedding_dimensions
                or any(
                    type(v) not in (int, float) or not math.isfinite(v) for v in vector
                )
            ):
                raise ValueError("Invalid embedding vector")
            await store.update(
                "chunks",
                {"_id": chunk["_id"]},
                {
                    **review,
                    "reviewed": True,
                    "reviewed_at": now().date().isoformat(),
                    "embedding": vector,
                    "embedding_model": settings.embedding_model,
                    "embedding_dimensions": settings.embedding_dimensions,
                },
            )
        # Ponytail: four concurrent requests suit the small corpus; use a provider batch job at larger scale.
        for start in range(0, len(chunks), 4):
            results = await asyncio.gather(*(embed_chunk(chunk) for chunk in chunks[start:start + 4]), return_exceptions=True)
            failure = next((result for result in results if isinstance(result, BaseException)), None)
            if failure:
                raise failure
    elif any(
        c.get("embedding_model") != settings.embedding_model
        or c.get("embedding_dimensions") != settings.embedding_dimensions
        for c in chunks
    ):
        raise ValueError("Reviewed version embedding configuration is immutable")
    await store.update(
        "document_versions",
        {"_id": version_id},
        {"reviewed": True, "review": review, "reviewed_at": now()},
    )
    # Publish the pointer and active flags atomically. Concurrent activation must not
    # deactivate a newer version while cleaning up the previous one.
    async with store.transaction() as tx:
        result = await tx.update(
            "documents",
            {
                "_id": version["document_id"],
                "active_version": document.get("active_version"),
            },
            {"active_version": version_id},
        )
        if result.matched_count != 1:
            raise ValueError("Active version changed concurrently; retry activation")
        for chunk in chunks:
            await tx.update("chunks", {"_id": chunk["_id"]}, {"active": True})
        previous = await tx.find(
            "chunks", {"document_id": version["document_id"], "active": True}, limit=0
        )
        for chunk in previous:
            if chunk["version_id"] != version_id:
                await tx.update("chunks", {"_id": chunk["_id"]}, {"active": False})
        await tx.insert(
            "audit_events",
            {
                "_id": f"activate-{version_id}-{now().timestamp()}",
                "event": "source_activated",
                "version_id": version_id,
                "reviewer": review["reviewer"],
                "created_at": now(),
                "expires_at": now() + timedelta(days=90),
            },
        )
    return {"version_id": version_id, "active": True, "chunks": len(chunks)}
