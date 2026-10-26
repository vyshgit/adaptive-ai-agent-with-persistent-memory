"""Minimal standard-library client for the RecallLoop HTTP API prototype.

Usage:
  RECALLLOOP_URL=http://localhost:3000 python examples/python/quickstart.py

This demonstrates the API contract. The current server's recall index is
process-local, so query-based recall is not restart-durable yet.
"""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = os.environ.get("RECALLLOOP_URL", "http://localhost:3000").rstrip("/")
AGENT_ID = "example-agent"


def post_json(path: str, payload: dict) -> dict:
    request = Request(
        f"{BASE_URL}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"RecallLoop returned HTTP {error.code}: {details}") from error
    except URLError as error:
        raise RuntimeError(f"Could not connect to RecallLoop: {error.reason}") from error


if __name__ == "__main__":
    stored = post_json(
        "/api/walrus/store",
        {
            "agentId": AGENT_ID,
            "title": "Provider timeout during refund",
            "taskTitle": "Process refund request",
            "outcome": "failed",
            "feedback": "Provider timed out after submission.",
            "plannedDurationMinutes": 5,
            "lesson": "Check request status before retrying to avoid duplicate actions.",
            "metadata": {"tags": ["payments", "timeout"]},
        },
    )
    memory = stored["memory"]
    print("Stored Walrus blob:", memory["blobId"])

    recalled = post_json(
        "/api/walrus/recall",
        {
            "agentId": AGENT_ID,
            "query": "provider timeout retry refund",
            "limit": 5,
        },
    )
    print(json.dumps(recalled, indent=2))
