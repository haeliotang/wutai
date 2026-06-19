from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from evidence_gate import (  # noqa: E402
    build_evidence_artifacts,
    classify_source,
    parse_json_object,
)


class EvidenceGateTests(unittest.TestCase):
    def test_source_classification_distinguishes_primary_and_secondary(self) -> None:
        self.assertEqual(
            classify_source("https://github.com/openclaw/openclaw/blob/main/LICENSE"),
            "repository",
        )
        self.assertEqual(
            classify_source("https://qoder.com/en/qoderwork"), "primary"
        )
        self.assertEqual(
            classify_source("https://example-news.test/product-review"),
            "secondary",
        )

    def test_json_parser_accepts_single_fenced_object(self) -> None:
        self.assertEqual(
            parse_json_object('```json\n{"claims": []}\n```'), {"claims": []}
        )

    def test_openclaw_apache_claim_fails_locked_fact_regression(self) -> None:
        url = "https://github.com/openclaw/openclaw/blob/main/LICENSE"
        claims, verification = build_evidence_artifacts(
            "task_test",
            [{"url": url, "title": "OpenClaw license"}],
            {
                "claims": [
                    {
                        "text": "OpenClaw is licensed under Apache 2.0.",
                        "entity": "OpenClaw",
                        "category": "license",
                        "statementType": "factual_claim",
                        "support": "supported",
                        "evidenceSummary": "The repository license supports it.",
                        "sourceUrls": [url],
                    }
                ]
            },
        )

        self.assertEqual(claims["claims"][0]["support"], "conflicting")
        self.assertEqual(
            claims["claims"][0]["verificationSource"],
            "https://github.com/openclaw/openclaw/blob/main/LICENSE",
        )
        self.assertEqual(verification["status"], "fail")
        self.assertEqual(verification["metrics"]["conflictCount"], 1)

    def test_correct_primary_license_claim_passes(self) -> None:
        url = "https://github.com/openclaw/openclaw/blob/main/LICENSE"
        _, verification = build_evidence_artifacts(
            "task_test",
            [{"url": url, "title": "OpenClaw license"}],
            {
                "claims": [
                    {
                        "text": "OpenClaw is licensed under the MIT License.",
                        "entity": "OpenClaw",
                        "category": "license",
                        "statementType": "factual_claim",
                        "support": "supported",
                        "evidenceSummary": "The repository LICENSE file states MIT.",
                        "sourceUrls": [url],
                    }
                ]
            },
        )

        self.assertEqual(verification["status"], "pass")
        self.assertTrue(verification["readyForTrust"])

    def test_high_risk_claim_without_primary_source_warns(self) -> None:
        url = "https://example-news.test/openclaw-license"
        _, verification = build_evidence_artifacts(
            "task_test",
            [{"url": url, "title": "A secondary article"}],
            {
                "claims": [
                    {
                        "text": "OpenClaw is licensed under the MIT License.",
                        "entity": "OpenClaw",
                        "category": "license",
                        "statementType": "third_party_observation",
                        "support": "supported",
                        "evidenceSummary": "A secondary article says it is MIT.",
                        "sourceUrls": [url],
                    }
                ]
            },
        )

        self.assertEqual(verification["status"], "warning")
        self.assertEqual(verification["metrics"]["highRiskGapCount"], 1)
        self.assertFalse(verification["readyForTrust"])

    def test_unqualified_multica_apache_claim_is_conflicting(self) -> None:
        url = "https://github.com/multica-ai/multica/blob/main/LICENSE"
        claims, verification = build_evidence_artifacts(
            "task_test",
            [{"url": url, "title": "Multica license"}],
            {
                "claims": [
                    {
                        "text": "Multica uses the Apache 2.0 license.",
                        "entity": "Multica",
                        "category": "license",
                        "statementType": "factual_claim",
                        "support": "supported",
                        "evidenceSummary": "The repository contains a license file.",
                        "sourceUrls": [url],
                    }
                ]
            },
        )

        self.assertEqual(claims["claims"][0]["support"], "conflicting")
        self.assertEqual(verification["status"], "fail")


if __name__ == "__main__":
    unittest.main()
