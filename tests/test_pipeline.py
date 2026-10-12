import importlib.util
import unittest
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1] / "pipeline" / "fetch_data.py"
SPEC = importlib.util.spec_from_file_location("gpir_fetch_data", PIPELINE)
GPIR = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(GPIR)


class PipelineTransformationTests(unittest.TestCase):
    def setUp(self):
        self.reporters = {"USA": {"reporter_code": 842, "name": "United States"}}
        self.countries = {
            "USA": {"name": "United States", "latitude": 38.0, "longitude": -97.0,
                    "gdp_per_capita_usd": 50000.0, "gdp_per_capita_year": 2024,
                    "population": 1000.0, "population_year": 2024}
        }

    def test_calculates_growth_and_score(self):
        base = {"cmdCode": "854231", "cmdDesc": "Example electronic product",
                "classificationCode": "H6", "primaryValue": 100.0, "netWgt": 10, "qty": 10}
        rows = {("USA", 2022): [base], ("USA", 2023): [{**base, "primaryValue": 125.0}],
                ("USA", 2024): [{**base, "primaryValue": 150.0}]}
        items = GPIR.build_items(rows, self.reporters, self.countries, [2022, 2023, 2024], "live")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["product_code"], "854231")
        self.assertAlmostEqual(items[0]["yoy_growth_pct"], 20.0)
        self.assertIsNotNone(items[0]["opportunity_score"])

    def test_filters_non_six_digit_totals(self):
        rows = {("USA", 2024): [
            {"cmdCode": "85", "cmdDesc": "Electrical machinery chapter", "primaryValue": 5000},
            {"cmdCode": "854231", "cmdDesc": "Integrated circuits", "primaryValue": 1000}]}
        items = GPIR.build_items(rows, self.reporters, self.countries, [2024], "live")
        self.assertEqual([item["product_code"] for item in items], ["854231"])

    def test_cagr_handles_nonpositive_or_single_year_data(self):
        self.assertIsNone(GPIR.safe_cagr(0, 100, 3))
        self.assertIsNone(GPIR.safe_cagr(100, 200, 0))
        self.assertAlmostEqual(GPIR.safe_cagr(100, 121, 2), 10.0)


if __name__ == "__main__":
    unittest.main()
