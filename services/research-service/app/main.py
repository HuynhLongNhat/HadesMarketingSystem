"""Private Market Intelligence research service.

This service is intentionally reachable only by the Nova API on its Docker
network (or loopback during local development). It never receives provider
credentials and does not call an LLM.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
from datetime import datetime, timezone
from hashlib import sha256
from typing import Literal
from urllib.parse import urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx
import trafilatura
from fastapi import FastAPI, HTTPException
from pydantic import AnyHttpUrl, BaseModel, Field
from .pain_engine import analyze_evidence

SEARXNG_URL = os.getenv("SEARXNG_URL", "http://searxng:8080").rstrip("/")
HTTP_TIMEOUT_SECONDS = float(os.getenv("RESEARCH_HTTP_TIMEOUT_SECONDS", "15"))
MAX_RESPONSE_BYTES = int(os.getenv("RESEARCH_MAX_RESPONSE_BYTES", "1500000"))
MAX_CONCURRENCY = int(os.getenv("RESEARCH_MAX_CONCURRENCY", "4"))
MAX_HTTP_ATTEMPTS = int(os.getenv("RESEARCH_MAX_HTTP_ATTEMPTS", "2"))
USER_AGENT = "NovaAIResearchBot/1.0 (+internal-market-intelligence)"

app = FastAPI(title="Nova Research Service", docs_url=None, redoc_url=None)
semaphore = asyncio.Semaphore(MAX_CONCURRENCY)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    max_results: int = Field(default=8, ge=1, le=20)


class ExtractRequest(BaseModel):
    url: AnyHttpUrl


class ResearchRequest(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=8)
    max_results: int = Field(default=8, ge=1, le=20)


class Evidence(BaseModel):
    title: str
    url: str
    canonical_url: str
    domain: str
    snippet: str | None = None
    extracted_content: str | None = None
    extraction_status: Literal["retrieved", "blocked", "failed"]
    extraction_error: str | None = None
    retrieved_at: datetime
    content_hash: str | None = None


def canonicalize(raw_url: str) -> str:
    parsed = urlsplit(raw_url)
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path or "/", parsed.query, ""))


async def is_public_http_url(raw_url: str) -> bool:
    try:
        parsed = urlsplit(raw_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            return False
        # Do not permit a search result to redirect this internal extractor to
        # loopback, link-local, private, multicast, or reserved network space.
        addresses = await asyncio.get_running_loop().getaddrinfo(parsed.hostname, None, type=socket.SOCK_STREAM)
        for _, _, _, _, sockaddr in addresses:
            ip = ipaddress.ip_address(sockaddr[0])
            if not ip.is_global:
                return False
        return True
    except (ValueError, socket.gaierror):
        return False


async def robots_allows(client: httpx.AsyncClient, raw_url: str) -> bool:
    parsed = urlsplit(raw_url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        response = await request_with_retry(client, "GET", robots_url)
        if 300 <= response.status_code < 400:
            return False
        if response.status_code >= 400:
            return response.status_code == 404
        parser = RobotFileParser()
        parser.parse(response.text.splitlines())
        return parser.can_fetch(USER_AGENT, raw_url)
    except httpx.HTTPError:
        # A source whose robots policy cannot be read is skipped rather than
        # treated as consent to crawl it.
        return False


async def request_with_retry(client: httpx.AsyncClient, method: str, url: str, **kwargs) -> httpx.Response:
    """Retry only transient upstream failures a bounded number of times."""
    last_error: httpx.HTTPError | None = None
    for attempt in range(max(1, min(MAX_HTTP_ATTEMPTS, 3))):
        try:
            response = await client.request(method, url, follow_redirects=False, **kwargs)
            if response.status_code == 429 or response.status_code >= 500:
                await response.aclose()
                raise httpx.HTTPStatusError("Temporary upstream response", request=response.request, response=response)
            return response
        except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as error:
            last_error = error
            if attempt + 1 < max(1, min(MAX_HTTP_ATTEMPTS, 3)):
                await asyncio.sleep(0.25 * (attempt + 1))
    assert last_error is not None
    raise last_error


async def search(client: httpx.AsyncClient, request: SearchRequest) -> list[dict]:
    response = await request_with_retry(client, "GET", f"{SEARXNG_URL}/search", params={"q": request.query, "format": "json", "language": "all", "safesearch": 1})
    response.raise_for_status()
    try:
        body = response.json()
    except ValueError as error:
        raise httpx.HTTPError("SearXNG did not return JSON.") from error
    values = body.get("results", []) if isinstance(body, dict) else []
    return [value for value in values if isinstance(value, dict)][: request.max_results]


async def extract(client: httpx.AsyncClient, raw_url: str, title: str = "", snippet: str | None = None) -> Evidence:
    now = datetime.now(timezone.utc)
    canonical_url = canonicalize(raw_url)
    parsed = urlsplit(canonical_url)
    if not await is_public_http_url(canonical_url):
        return Evidence(title=title or parsed.hostname, url=raw_url, canonical_url=canonical_url, domain=parsed.hostname or "", snippet=snippet, extraction_status="blocked", extraction_error="URL không phải nguồn Internet công khai an toàn.", retrieved_at=now)
    async with semaphore:
        if not await robots_allows(client, canonical_url):
            return Evidence(title=title or parsed.hostname, url=raw_url, canonical_url=canonical_url, domain=parsed.hostname or "", snippet=snippet, extraction_status="blocked", extraction_error="Nguồn không cho phép thu thập tự động.", retrieved_at=now)
        try:
            async with client.stream("GET", canonical_url, follow_redirects=False) as response:
                if 300 <= response.status_code < 400:
                    raise ValueError("Nguồn chuyển hướng; không theo redirect tự động.")
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").lower()
                if "html" not in content_type and "text/" not in content_type:
                    raise ValueError("Nguồn không trả về HTML hoặc văn bản.")
                payload = bytearray()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > MAX_RESPONSE_BYTES:
                        raise ValueError("Nội dung nguồn vượt giới hạn cho phép.")
            extracted = trafilatura.extract(bytes(payload), include_comments=False, include_tables=True, output_format="txt")
            if not extracted:
                raise ValueError("Không thể trích xuất nội dung có thể đọc.")
            content = extracted.strip()[:40000]
            return Evidence(title=title or parsed.hostname, url=raw_url, canonical_url=canonical_url, domain=parsed.hostname or "", snippet=snippet, extracted_content=content, extraction_status="retrieved", retrieved_at=now, content_hash=sha256(content.encode("utf-8")).hexdigest())
        except (httpx.HTTPError, ValueError) as error:
            return Evidence(title=title or parsed.hostname, url=raw_url, canonical_url=canonical_url, domain=parsed.hostname or "", snippet=snippet, extraction_status="failed", extraction_error=str(error)[:256], retrieved_at=now)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "searxng_url": SEARXNG_URL}


@app.post("/search")
async def search_endpoint(request: SearchRequest) -> dict:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        try:
            return {"query": request.query, "results": await search(client, request)}
        except httpx.HTTPError as error:
            raise HTTPException(status_code=503, detail="SearXNG không sẵn sàng.") from error


@app.post("/extract")
async def extract_endpoint(request: ExtractRequest) -> Evidence:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        return await extract(client, str(request.url))


@app.post("/research")
async def research(request: ResearchRequest) -> dict:
    clean_queries = list(dict.fromkeys(query.strip()[:500] for query in request.queries if query.strip()))
    if not clean_queries:
        raise HTTPException(status_code=422, detail="Cần ít nhất một truy vấn nghiên cứu.")
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        try:
            search_batches = await asyncio.gather(*(search(client, SearchRequest(query=query, max_results=request.max_results)) for query in clean_queries))
        except httpx.HTTPError as error:
            raise HTTPException(status_code=503, detail="SearXNG không sẵn sàng.") from error
        candidates: list[tuple[str, dict]] = []
        seen: set[str] = set()
        for query, results in zip(clean_queries, search_batches):
            for result in results:
                raw_url = result.get("url")
                if not isinstance(raw_url, str):
                    continue
                canonical = canonicalize(raw_url)
                if canonical in seen or not await is_public_http_url(canonical):
                    continue
                seen.add(canonical)
                candidates.append((query, result))
                if len(candidates) >= request.max_results:
                    break
            if len(candidates) >= request.max_results:
                break
        evidence = await asyncio.gather(*(extract(client, str(result["url"]), str(result.get("title") or ""), str(result.get("content") or result.get("snippet") or "")[:12000] or None) for _, result in candidates))
        serialized = [item.model_dump(mode="json") for item in evidence]
        return {"provider": "searxng", "queries": clean_queries, "sources": serialized,
                "pain_signals": analyze_evidence(serialized)}
