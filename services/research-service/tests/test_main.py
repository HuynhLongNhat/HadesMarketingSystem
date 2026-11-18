import httpx
import unittest
from unittest.mock import AsyncMock, patch

from app.main import SearchRequest, extract, search


class ResearchServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_retries_transient_rate_limit_once(self):
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(429, request=request)
            return httpx.Response(200, json={"results": [{"title": "Nguồn", "url": "https://example.com", "content": "Bằng chứng"}]}, request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            results = await search(client, SearchRequest(query="nghiên cứu", max_results=3))

        self.assertEqual(calls, 2)
        self.assertEqual(results[0]["url"], "https://example.com")

    async def test_extract_blocks_private_target_without_requesting_it(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: self.fail("private URL must not be fetched"))) as client:
            evidence = await extract(client, "http://127.0.0.1/internal")

        self.assertEqual(evidence.extraction_status, "blocked")
        self.assertIsNone(evidence.extracted_content)

    async def test_extract_preserves_partial_failure(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch("app.main.is_public_http_url", new=AsyncMock(return_value=True)), patch("app.main.robots_allows", new=AsyncMock(return_value=True)):
                evidence = await extract(client, "https://example.com/unavailable")

        self.assertEqual(evidence.extraction_status, "failed")
        self.assertIsNotNone(evidence.extraction_error)


if __name__ == "__main__":
    unittest.main()
