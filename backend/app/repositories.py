"""Thin MongoDB boundary. All caller-supplied IDs remain strings, not query objects."""

from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from copy import copy
from uuid import uuid4
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError


def now() -> datetime:
    return datetime.now(timezone.utc)


class MongoStore:
    def __init__(self, uri: str, database: str):
        self.client = AsyncMongoClient(
            uri, serverSelectionTimeoutMS=5000, tz_aware=True
        )
        self.db = self.client[database]
        self.session = None

    @asynccontextmanager
    async def transaction(self):
        """Keep related writes atomic on Atlas (or a local replica set)."""
        async with self.client.start_session() as session:
            async with await session.start_transaction():
                store = copy(self)
                store.session = session
                yield store

    async def setup(self):
        await self.client.admin.command("ping")
        await self.db.consultations.create_index([("owner_id", 1), ("updated_at", -1)])
        await self.db.messages.create_index([("consultation_id", 1), ("created_at", 1)])
        await self.db.chunks.create_index(
            [("version_id", 1), ("index", 1)], unique=True
        )
        await self.db.document_versions.create_index(
            [("source_id", 1), ("content_hash", 1)], unique=True
        )
        for collection in [
            "runs",
            "audit_events",
            "rate_limits",
        ]:
            await self.db[collection].create_index("expires_at", expireAfterSeconds=0)

    async def close(self):
        await self.client.close()

    async def get(self, collection, query):
        return await self.db[collection].find_one(query, session=self.session)

    async def find(self, collection, query, limit=500, sort=None):
        cursor = self.db[collection].find(query, session=self.session)
        if sort:
            cursor = cursor.sort(sort)
        return await cursor.limit(limit).to_list(length=limit or None)

    async def insert(self, collection, document):
        await self.db[collection].insert_one(document.copy(), session=self.session)
        return document

    async def update(self, collection, query, changes):
        return await self.db[collection].update_one(
            query, {"$set": changes}, session=self.session
        )

    async def delete(self, collection, query):
        return await self.db[collection].delete_many(query, session=self.session)

    async def consume(self, collection, query):
        return await self.db[collection].find_one_and_delete(
            query, session=self.session
        )

    async def lease(self, consultation_id, owner_id):
        token = str(uuid4())
        doc = await self.db.consultations.find_one_and_update(
            {
                "_id": consultation_id,
                "owner_id": owner_id,
                "$or": [
                    {"busy_until": {"$exists": False}},
                    {"busy_until": {"$lt": now()}},
                ],
            },
            {
                "$set": {
                    "busy_until": now() + timedelta(minutes=3),
                    "lease_token": token,
                }
            },
            return_document=ReturnDocument.AFTER,
            session=self.session,
        )
        return token if doc else None

    async def release(self, consultation_id, token):
        await self.db.consultations.update_one(
            {"_id": consultation_id, "lease_token": token},
            {"$unset": {"busy_until": "", "lease_token": ""}},
            session=self.session,
        )

    async def rate_limit(self, key, maximum, seconds):
        bucket = int(now().timestamp()) // seconds
        identifier = f"{key}:{bucket}"
        try:
            result = await self.db.rate_limits.find_one_and_update(
                {"_id": identifier},
                {
                    "$inc": {"count": 1},
                    "$setOnInsert": {
                        "expires_at": now() + timedelta(seconds=seconds * 2)
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
        except DuplicateKeyError:
            result = await self.db.rate_limits.find_one_and_update(
                {"_id": identifier},
                {"$inc": {"count": 1}},
                return_document=ReturnDocument.AFTER,
            )
        return result["count"] <= maximum

    def search_filters(self, scope, embedding_model, dimensions):
        return {
            "scope": scope,
            "active": True,
            "reviewed": True,
            "current_reviewed": True,
            "access": "public",
            "legal_status": {
                "$in": ["in_force", "official_guidance", "adopted_not_in_force"]
            },
            "embedding_model": embedding_model,
            "embedding_dimensions": dimensions,
        }

    async def vector_search(self, vector, scope, embedding_model, dimensions, limit=25):
        filters = self.search_filters(scope, embedding_model, dimensions)
        pipeline = [
            {
                "$vectorSearch": {
                    "index": "chunks_vector",
                    "path": "embedding",
                    "queryVector": vector,
                    "numCandidates": max(100, limit * 10),
                    "limit": limit,
                    "filter": filters,
                }
            },
            {"$project": {"embedding": 0}},
        ]
        return await (await self.db.chunks.aggregate(pipeline)).to_list(length=limit)

    async def lexical_search(self, query, scope, embedding_model, dimensions, limit=25):
        filters = self.search_filters(scope, embedding_model, dimensions)
        text_filters = [
            {"in": {"path": key, "value": value["$in"]}}
            if isinstance(value, dict)
            else {"equals": {"path": key, "value": value}}
            for key, value in filters.items()
        ]
        pipeline = [
            {
                "$search": {
                    "index": "chunks_lexical",
                    "compound": {
                        "must": [
                            {
                                "text": {
                                    "query": query,
                                    "path": ["content", "title", "locator"],
                                }
                            }
                        ],
                        "filter": text_filters,
                    },
                }
            },
            {"$limit": limit},
            {"$project": {"embedding": 0}},
        ]
        return await (await self.db.chunks.aggregate(pipeline)).to_list(length=limit)
