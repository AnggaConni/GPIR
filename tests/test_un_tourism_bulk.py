import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "pipeline" / "import_un_tourism_bulk.py"
SPEC = importlib.util.spec_from_file_location("gpir_un_tourism_bulk", SCRIPT)
BULK = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(BULK)


class UnTourismBulkTests(unittest.TestCase):
    def test_slug_sanitizes_names(self):
        self.assertEqual(BULK.slug("Arrivals / Tourism: 2024"), "Arrivals_Tourism_2024")

    def test_safe_extract_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            archive = base / "bad.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.writestr("../outside.txt", "not allowed")
            with self.assertRaises(ValueError):
                BULK.safe_extract(archive, base / "extract")
            self.assertFalse((base / "outside.txt").exists())

    def test_export_workbook_preserves_grid_and_nulls(self):
        from openpyxl import Workbook
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            workbook = base / "sample.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.title = "Inbound Tourism"
            ws.append(["Country", "Year", "Arrivals"])
            ws.append(["Indonesia", 2024, 123456])
            ws.append([None, None, None])
            wb.save(workbook)
            wb.close()
            reports = BULK.export_workbook(workbook, base / "out", "https://example.test/file.zip", "2026-10-13T00:00:00+00:00")
            self.assertEqual(len(reports), 1)
            payload = json.loads((base / "out" / reports[0]["file"]).read_text(encoding="utf-8"))
            self.assertEqual(payload["data"][0], ["Country", "Year", "Arrivals"])
            self.assertEqual(payload["data"][1], ["Indonesia", 2024, 123456])
            self.assertEqual(payload["meta"]["row_count"], 2)
            self.assertEqual(payload["meta"]["layout"], "grid")


if __name__ == "__main__":
    unittest.main()
