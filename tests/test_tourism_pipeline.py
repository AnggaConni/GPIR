import importlib.util
import unittest
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1] / "pipeline" / "fetch_tourism_data.py"
SPEC = importlib.util.spec_from_file_location("gpir_fetch_tourism_data", PIPELINE)
TOURISM = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(TOURISM)


class TourismNormalizationTests(unittest.TestCase):
    def test_haversine_distance_is_in_kilometres(self):
        self.assertAlmostEqual(TOURISM.haversine_km(0, 0, 0, 1), 111.195, places=1)

    def test_opentripmap_record_requires_name_and_coordinates(self):
        seed = {"id": "test-city", "name": "Test City", "lat": -6.2, "lon": 106.8}
        row = {"xid": "Q123", "name": "Test Museum", "dist": 1200, "kinds": "museums,historic",
               "point": {"lat": -6.21, "lon": 106.81}}
        got = TOURISM.normalise_opentripmap(row, seed)
        self.assertEqual(got["source"], "OpenTripMap")
        self.assertEqual(got["category"], "cultural_attraction")
        self.assertEqual(got["distance_from_seed_km"], 1.2)
        self.assertIsNone(TOURISM.normalise_opentripmap({"xid": "Q123", "point": {"lat": 1, "lon": 2}}, seed))

    def test_wikivoyage_is_metadata_only(self):
        seed = {"id": "test-city", "name": "Test City", "lat": 1, "lon": 2}
        got = TOURISM.normalize_wikivoyage({"pageid": 123, "title": "A Test Place", "lat": 1.01, "lon": 2.01}, seed, "en")
        self.assertEqual(got["kind"], "travel_guide")
        self.assertIn("wikivoyage.org/wiki/A_Test_Place", got["url"])
        self.assertIn("no article body copied", got["license"])

    def test_unesco_record_normalizes_country_and_year(self):
        got = TOURISM.normalize_ich_record({
            "id": "ich-1", "name_en": "Traditional pottery", "countries": ["Indonesia", "Malaysia"],
            "inscription_year": "2022", "description_en": "A traditional skill"
        })
        self.assertEqual(got["name"], "Traditional pottery")
        self.assertEqual(got["country_or_countries"], "Indonesia; Malaysia")
        self.assertEqual(got["inscription_year"], 2022)
        self.assertEqual(got["license"], "CC BY-SA 4.0")

    def test_openfoodfacts_record_is_not_sales_evidence(self):
        got = TOURISM.normalize_food_product({
            "code": "899999", "product_name": "Local snack", "brands": "Example", "quantity": "80 g",
            "categories_tags_en": ["snacks", "salty-snacks"], "countries_tags": ["en:indonesia"]
        }, "banana chips")
        self.assertEqual(got["barcode"], "899999")
        self.assertEqual(got["brands"], "Example")
        self.assertEqual(got["evidence_type"], "packaged_product_catalogue_not_sales")
        self.assertIn("not sales", got["evidence_type"])

    def test_opentripmap_is_gracefully_skipped_without_key(self):
        class NeverCallSession:
            def get(self, *args, **kwargs):
                raise AssertionError("API must not be called without a key")
        rows, status = TOURISM.collect_opentripmap(NeverCallSession(), [], "")
        self.assertEqual(rows, [])
        self.assertEqual(status["status"], "skipped_missing_api_key")


if __name__ == "__main__":
    unittest.main()
