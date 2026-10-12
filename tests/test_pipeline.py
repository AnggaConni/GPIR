import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_data", ROOT / "scripts" / "build_data.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class TransformTests(unittest.TestCase):
    def test_growth_requires_valid_positive_prior_period(self):
        self.assertEqual(module.percent_change(120, 100), 20.0)
        self.assertIsNone(module.percent_change(120, 0))
        self.assertIsNone(module.percent_change(None, 100))

    def test_hs_chapter_not_mislabelled_as_six_digit_code(self):
        self.assertEqual(module.hs_level("85"), 2)
        self.assertEqual(module.hs_level("8542"), 4)
        self.assertEqual(module.hs_level("854231"), 6)

    def test_cagr_requires_positive_endpoints(self):
        self.assertAlmostEqual(module.cagr(100, 121, 2), 10.0)
        self.assertIsNone(module.cagr(0, 121, 2))
        self.assertIsNone(module.cagr(100, None, 2))


if __name__ == "__main__":
    unittest.main()
