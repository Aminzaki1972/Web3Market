import importlib.util
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[2] / "scripts" / "w3m-contract-analysis" / "normalize.py"
SPEC = importlib.util.spec_from_file_location("w3m_normalize", MODULE)
NORMALIZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NORMALIZER)


class NormalizeTests(unittest.TestCase):
    def test_slither_maps_detector_and_source_location(self):
        data = {
            "success": True,
            "results": {
                "detectors": [{
                    "check": "reentrancy-eth",
                    "impact": "High",
                    "confidence": "Medium",
                    "description": "External call before state update.",
                    "elements": [{
                        "source_mapping": {
                            "filename_relative": "src/Vault.sol",
                            "lines": [41, 42]
                        }
                    }]
                }]
            }
        }
        rows = NORMALIZER.normalize_slither(data)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["engine"], "slither")
        self.assertEqual(rows[0]["severity"], "high")
        self.assertEqual(rows[0]["file_path"], "src/Vault.sol")
        self.assertEqual(rows[0]["line_start"], 41)
        self.assertFalse(rows[0]["confirmed"])

    def test_aderyn_tolerates_nested_issue_shape(self):
        data = {
            "high_issues": [{
                "title": "Unprotected initializer",
                "detector": "unprotected-initializer",
                "severity": "High",
                "description": "Initializer can be called by an arbitrary account.",
                "location": {"file": "src/Proxy.sol", "line": 17}
            }]
        }
        rows = NORMALIZER.normalize_aderyn(data)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["engine"], "aderyn")
        self.assertEqual(rows[0]["file_path"], "src/Proxy.sol")
        self.assertEqual(rows[0]["line_start"], 17)
        self.assertEqual(rows[0]["triage_status"], "needs_ai_triage")

    def test_aderyn_06_issue_bucket_and_instances_shape(self):
        data = {
            "issue_count": {"high": 1, "low": 1},
            "high_issues": {"issues": [{
                "title": "Reentrancy: State change after external call",
                "description": "State changes after an external call.",
                "detector_name": "reentrancy-state-change",
                "instances": [
                    {"contract_path": "contracts/Vault.sol", "line_no": 15},
                    {"contract_path": "contracts/Vault.sol", "line_no": 28},
                ],
            }]},
            "low_issues": {"issues": [{
                "title": "State Change Without Event",
                "description": "Emit an event after changing state.",
                "detector_name": "state-change-without-event",
                "instances": [{"contract_path": "contracts/Vault.sol", "line_no": 9}],
            }]},
        }
        rows = NORMALIZER.normalize_aderyn(data)
        self.assertEqual(len(rows), 3)
        self.assertEqual([row["severity"] for row in rows], ["high", "high", "low"])
        self.assertEqual(rows[0]["file_path"], "contracts/Vault.sol")
        self.assertEqual(rows[0]["line_start"], 15)
        self.assertTrue(all(row["triage_status"] == "needs_ai_triage" for row in rows))
        self.assertTrue(all(row["confirmed"] is False for row in rows))

    def test_no_automatic_cross_engine_confirmation(self):
        a = NORMALIZER.make_finding("slither", "detector-a", "Same area", "x",
                                    "High", "High", "src/A.sol", 9, 9)
        b = NORMALIZER.make_finding("aderyn", "detector-b", "Same area", "x",
                                    "High", "High", "src/A.sol", 9, 9)
        self.assertNotEqual(a["fingerprint"], b["fingerprint"])
        self.assertFalse(a["confirmed"])
        self.assertFalse(b["confirmed"])


if __name__ == "__main__":
    unittest.main()
