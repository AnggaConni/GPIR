import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_data", ROOT / "pipeline" / "fetch_data.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class TransformTests(unittest.TestCase):
    def test_safe_cagr_requires_positive_endpoints(self):
        self.assertAlmostEqual(module.safe_cagr(100, 121, 2), 10.0)
        self.assertIsNone(module.safe_cagr(0, 121, 2))
        self.assertIsNone(module.safe_cagr(100, -5, 2))
        self.assertIsNone(module.safe_cagr(100, 121, 0))

    def test_hs_codes_are_six_digit_products_only(self):
        raw = {
            ("USA", 2022): [
                {"cmdCode": "85", "primaryValue": 999999999, "cmdDesc": "chapter total"},
                {"cmdCode": "8542", "primaryValue": 777777777, "cmdDesc": "heading total"},
                {"cmdCode": "854231", "primaryValue": 100, "cmdDesc": "processors", "classificationCode": "H5"},
                {"cmdCode": "854232", "primaryValue": 200, "cmdDesc": "memories", "classificationCode": "H5"},
            ],
            ("USA", 2023): [
                {"cmdCode": "85", "primaryValue": 888888888, "cmdDesc": "chapter total"},
                {"cmdCode": "854231", "primaryValue": 150, "cmdDesc": "processors", "classificationCode": "H5"},
                {"cmdCode": "854232", "primaryValue": 250, "cmdDesc": "memories", "classificationCode": "H5"},
            ],
        }
        reporter = {"USA": {"reporter_code": 842, "name": "United States"}}
        countries = {"USA": {"name": "United States", "latitude": 38, "longitude": -97, "gdp_per_capita_usd": 70000}}
        items = module.build_items(raw, reporter, countries, [2022, 2023], "test")
        self.assertEqual({r["product_code"] for r in items}, {"854231", "854232"})
        self.assertTrue(all(len(r["product_code"]) == 6 for r in items))

    def test_percentile_map_is_bounded(self):
        got = module.percentile_map({"a": 10, "b": 20, "c": 20, "d": 40})
        self.assertTrue(all(0 <= x <= 100 for x in got.values()))
        self.assertLess(got["a"], got["d"])


if __name__ == "__main__":
    unittest.main()
