"""Tests for the Python health-service prototype."""

from __future__ import annotations

import json
import unittest

from pep_health.server import health_payload


class HealthPayloadTest(unittest.TestCase):
    def test_health_payload_is_stable_json(self) -> None:
        self.assertEqual(
            json.loads(health_payload()),
            {"service": "python", "status": "ok"},
        )


if __name__ == "__main__":
    unittest.main()
