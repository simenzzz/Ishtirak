from datetime import datetime, timezone

import httpx

from edge_agent.reading import Reading
from edge_agent.uploader import Uploader

AT = datetime(2026, 2, 1, 12, 0, 0, tzinfo=timezone.utc)
READING = Reading(meter_id="M-7", kwh=120.5, reading_at=AT)


def uploader_with(handler) -> Uploader:
    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    return Uploader("http://gw.local", "ishtdev_secret", client=client)


def test_posts_batch_with_bearer_and_parses_verdict():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = request.read().decode()
        return httpx.Response(200, json={"recorded": 1, "duplicates": 0, "errors": []})

    result = uploader_with(handler).upload([READING])

    assert captured["url"] == "http://gw.local/api/ingest/readings"
    assert captured["auth"] == "Bearer ishtdev_secret"
    assert '"meterId": "M-7"' in captured["body"] or '"meterId":"M-7"' in captured["body"]
    assert result.ok and result.recorded == 1


def test_5xx_is_a_retriable_failure():
    result = uploader_with(lambda _req: httpx.Response(503)).upload([READING])
    assert not result.ok and result.status == 503 and not result.terminal


def test_malformed_batch_4xx_is_terminal():
    result = uploader_with(lambda _req: httpx.Response(400)).upload([READING])
    assert not result.ok and result.terminal


def test_auth_and_rate_limit_4xx_are_retriable():
    for status in (401, 403, 429):
        result = uploader_with(lambda _req, s=status: httpx.Response(s)).upload([READING])
        assert not result.ok and not result.terminal, status


def test_network_error_is_a_transient_failure():
    def handler(_req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    result = uploader_with(handler).upload([READING])
    assert not result.ok and result.status == 0


def test_empty_batch_is_a_noop_success():
    calls = {"n": 0}

    def handler(_req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={})

    result = uploader_with(handler).upload([])
    assert result.ok and calls["n"] == 0
