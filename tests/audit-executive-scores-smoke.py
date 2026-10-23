# Free local smoke tests for W3M executive audit score display.
# Run with: python3 tests/audit-executive-scores-smoke.py
# Uses only Python's standard library; no API calls, secrets, database, or paid services.
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI_PATH = ROOT / "js" / "code-audit.js"
ENGINE_PATH = ROOT / "supabase" / "functions" / "w3m-code-audit" / "index.ts"
MIGRATION_PATH = ROOT / "supabase" / "migrations" / "20261023000100_add_audit_executive_scores.sql"


def display_score(value):
    """Mirror the UI metric's missing-value and score formatting contract."""
    if value is None:
        return "—"
    return f"{round(float(value))}/100"


class ExecutiveAuditScoreSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ui = UI_PATH.read_text(encoding="utf-8")
        cls.engine = ENGINE_PATH.read_text(encoding="utf-8")
        cls.migration = MIGRATION_PATH.read_text(encoding="utf-8")

    def test_both_scores_are_rendered_by_ui(self):
        self.assertIn('metric("Scalability (static estimate)",a.scalability_score)', self.ui)
        self.assertIn('metric("AI Fit (evidence-based)",a.ai_fit_score)', self.ui)

    def test_historical_missing_scores_render_as_dash(self):
        self.assertEqual(display_score(None), "—")
        self.assertIn('(v==null?"—":esc(Math.round(Number(v)))', self.ui)

    def test_valid_score_formatting(self):
        self.assertEqual(display_score(87), "87/100")
        self.assertEqual(display_score(72.6), "73/100")
        self.assertEqual(display_score(0), "0/100")

    def test_engine_requires_and_maps_both_scores(self):
        self.assertIn('"scalability","ai_fit"', self.engine)
        self.assertIn("scalability_score:sc.scalability", self.engine)
        self.assertIn("ai_fit_score:sc.ai_fit", self.engine)

    def test_migration_is_additive_and_keeps_historical_nulls(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS scalability_score integer", self.migration)
        self.assertIn("ADD COLUMN IF NOT EXISTS ai_fit_score integer", self.migration)
        self.assertIn("scalability_score IS NULL OR", self.migration)
        self.assertIn("ai_fit_score IS NULL OR", self.migration)
        self.assertNotRegex(self.migration, r"\bDROP\s+(TABLE|COLUMN)\b")

    def test_scores_are_bounded(self):
        for score in (-1, 101):
            self.assertFalse(0 <= score <= 100)
        for score in (0, 1, 50, 100):
            self.assertTrue(0 <= score <= 100)
        self.assertIn("scalability_score BETWEEN 0 AND 100", self.migration)
        self.assertIn("ai_fit_score BETWEEN 0 AND 100", self.migration)

    def test_limitations_are_disclosed(self):
        self.assertIn("not a load or production performance test", self.ui)
        self.assertIn("does not prove that an AI feature works", self.ui)


if __name__ == "__main__":
    unittest.main(verbosity=2)
