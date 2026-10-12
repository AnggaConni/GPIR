import importlib.util
import unittest
from unittest.mock import Mock
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

    def test_authenticated_trade_request_uses_subscription_header(self):
        session = Mock()
        response = session.get.return_value
        response.json.return_value = {"data": [{"cmdCode": "854231"}]}

        rows, mode = GPIR.fetch_trade_rows(session, 842, 2024, "test-api-key", 1000)

        self.assertEqual(mode, "live")
        self.assertEqual(rows, [{"cmdCode": "854231"}])
        _, kwargs = session.get.call_args
        self.assertEqual(kwargs["headers"], {"Ocp-Apim-Subscription-Key": "test-api-key"})
        self.assertNotIn("subscription-key", kwargs["params"])

    def test_missing_key_uses_limited_preview_endpoint(self):
        session = Mock()
        response = session.get.return_value
        response.json.return_value = {"data": []}

        rows, mode = GPIR.fetch_trade_rows(session, 842, 2024, "", 10000)

        self.assertEqual(mode, "preview")
        self.assertEqual(rows, [])
        args, kwargs = session.get.call_args
        self.assertIn("/public/v1/preview/", args[0])
        self.assertIsNone(kwargs["headers"])
        self.assertEqual(kwargs["params"]["maxrecords"], 500)

    def test_cagr_handles_nonpositive_or_single_year_data(self):
        self.assertIsNone(GPIR.safe_cagr(0, 100, 3))
        self.assertIsNone(GPIR.safe_cagr(100, 200, 0))
        self.assertAlmostEqual(GPIR.safe_cagr(100, 121, 2), 10.0)


if __name__ == "__main__":
    unittest.main()
