#!/usr/bin/env python3
"""Import the official UN Tourism bulk ZIP (Excel workbooks) into JSON snapshots.

Each worksheet is preserved as a grid rather than guessing the header row. A manifest
records source provenance, worksheet names and dimensions. These statistics are not
attraction-level visitor counts.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_URL = "https://pre-webunwto.s3.amazonaws.com/s3fs-public/2026-05/UN_Tourism_bulk_data_download_05_2026.zip"
DEFAULT_ARCHIVE = ROOT / "data" / "source_archives" / "UN_Tourism_bulk_data_download_05_2026.zip"
DEFAULT_OUTPUT = ROOT / "data" / "un_tourism"
USER_AGENT = "GlobalProductIntelligenceRadar/1.0 (+https://github.com/AnggaConni/GPIR; open-data research project)"
LOG = logging.getLogger("gpir.un_tourism_bulk")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slug(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._-")
    return value[:100] or "sheet"


def download_archive(url: str, target: Path, timeout: int = 90) -> Path:
    """Download an archive atomically and reject non-ZIP responses."""
    parsed = urlparse(url)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise ValueError("Bulk URL must be a valid HTTP(S) URL")
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    try:
        with requests.get(url, stream=True, timeout=(15, timeout), headers={"User-Agent": USER_AGENT}) as response:
            response.raise_for_status()
            with tmp.open("wb") as fh:
                for chunk in response.iter_content(chunk_size=1024 * 256):
                    if chunk:
                        fh.write(chunk)
        if not zipfile.is_zipfile(tmp):
            raise ValueError("Downloaded response is not a valid ZIP archive; check the URL or upstream response")
        tmp.replace(target)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    LOG.info("Downloaded %s (%s bytes)", target, target.stat().st_size)
    return target


def safe_extract(zip_path: Path, extract_dir: Path) -> list[Path]:
    """Extract archive members without allowing absolute paths or path traversal."""
    extract_dir.mkdir(parents=True, exist_ok=True)
    root = extract_dir.resolve()
    extracted: list[Path] = []
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            dest = (extract_dir / member.filename).resolve()
            if dest != root and root not in dest.parents:
                raise ValueError(f"Unsafe path inside ZIP: {member.filename}")
            dest.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as src, dest.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            extracted.append(dest)
    return extracted


def json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except (TypeError, ValueError):
            pass
    return str(value)


def export_workbook(path: Path, output_dir: Path, source_url: str, generated_at: str) -> list[dict[str, Any]]:
    if path.suffix.lower() not in {".xlsx", ".xlsm"}:
        return []
    reports: list[dict[str, Any]] = []
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        for sheet_index, sheet in enumerate(workbook.worksheets, start=1):
            rows = [[json_value(cell) for cell in row] for row in sheet.iter_rows(values_only=True)]
            while rows and all(value is None for value in rows[-1]):
                rows.pop()
            if not rows:
                continue
            out_path = output_dir / f"{slug(path.stem)}__{sheet_index:02d}_{slug(sheet.title)}.json"
            payload = {
                "schema_version": "1.0.0", "generated_at": generated_at,
                "meta": {
                    "source": "UN Tourism Statistics Database", "source_url": source_url,
                    "source_archive": path.name, "workbook": path.name, "worksheet": sheet.title,
                    "layout": "grid", "row_count": len(rows),
                    "column_count": max((len(row) for row in rows), default=0),
                    "note": "Worksheet values are preserved as a grid; header rows and indicators are not inferred automatically."
                },
                "data": rows
            }
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
            reports.append({"file": str(out_path.relative_to(output_dir)), "workbook": path.name,
                            "worksheet": sheet.title, "rows": len(rows),
                            "columns": max((len(row) for row in rows), default=0)})
    finally:
        workbook.close()
    return reports


def run(url: str = DEFAULT_URL, archive: Path = DEFAULT_ARCHIVE, output_dir: Path = DEFAULT_OUTPUT,
        refresh_download: bool = False) -> dict[str, Any]:
    if refresh_download or not archive.exists():
        download_archive(url, archive)
    if not zipfile.is_zipfile(archive):
        raise ValueError(f"Archive is missing or invalid: {archive}")

    generated_at = utc_now()
    output_dir.mkdir(parents=True, exist_ok=True)
    # Stage extraction and all JSON output outside the published snapshot.
    with tempfile.TemporaryDirectory(prefix="gpir-un-tourism-") as temp_root:
        staging = Path(temp_root)
        temp_extract = staging / "extracted"
        extracted = safe_extract(archive, temp_extract)
        workbooks = [p for p in extracted if p.suffix.lower() in {".xlsx", ".xlsm"}]
        if not workbooks:
            raise ValueError("No .xlsx or .xlsm workbooks were found in the ZIP. Inspect archive contents.")
        temp_json = staging / "sheets"
        temp_json.mkdir(parents=True, exist_ok=True)
        report: list[dict[str, Any]] = []
        for workbook_path in workbooks:
            report.extend(export_workbook(workbook_path, temp_json, url, generated_at))
        if not report:
            raise ValueError("Excel workbooks were found, but no non-empty worksheets could be exported")
        manifest = {
            "schema_version": "1.0.0", "generated_at": generated_at,
            "meta": {
                "source": "UN Tourism Statistics Database",
                "source_url": "https://www.untourism.int/tourism-statistics/tourism-statistics-database",
                "download_url": url, "archive": archive.name,
                "archive_size_bytes": archive.stat().st_size, "workbook_count": len(workbooks),
                "worksheet_count": len(report), "layout": "grid",
                "limitations": [
                    "Statistics retain original worksheet layout; automated header interpretation is intentionally not attempted.",
                    "National or regional tourism statistics are not attraction-level footfall.",
                    "The JSON reflects the archived release and is not live data."
                ]
            },
            "worksheets": report
        }
        manifest_tmp = staging / "manifest.json"
        manifest_tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        final_extract, final_json = output_dir / "extracted", output_dir / "sheets"
        old_extract, old_json = output_dir / "extracted.previous", output_dir / "sheets.previous"
        old_manifest = output_dir / "manifest.json.previous"
        manifest_path = output_dir / "manifest.json"
        manifest_tmp_path = output_dir / "manifest.json.tmp"
        for old in (old_extract, old_json, old_manifest):
            if old.exists():
                if old.is_dir():
                    shutil.rmtree(old)
                else:
                    old.unlink()
        # Move the prior snapshot aside, then restore all prior components if promotion fails.
        if final_extract.exists():
            final_extract.replace(old_extract)
        if final_json.exists():
            final_json.replace(old_json)
        if manifest_path.exists():
            manifest_path.replace(old_manifest)
        try:
            temp_extract.replace(final_extract)
            temp_json.replace(final_json)
            manifest_tmp_path.write_text(manifest_tmp.read_text(encoding="utf-8"), encoding="utf-8")
            manifest_tmp_path.replace(manifest_path)
        except Exception:
            shutil.rmtree(final_extract, ignore_errors=True)
            shutil.rmtree(final_json, ignore_errors=True)
            manifest_tmp_path.unlink(missing_ok=True)
            if old_extract.exists():
                old_extract.replace(final_extract)
            if old_json.exists():
                old_json.replace(final_json)
            if old_manifest.exists():
                old_manifest.replace(manifest_path)
            raise
        shutil.rmtree(old_extract, ignore_errors=True)
        shutil.rmtree(old_json, ignore_errors=True)
        old_manifest.unlink(missing_ok=True)
    LOG.info("Exported %d worksheets from %d workbooks to %s", len(report), len(workbooks), output_dir / "sheets")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.getenv("UN_TOURISM_BULK_URL", DEFAULT_URL), help="Official ZIP URL")
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE, help="Local ZIP path")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output directory")
    parser.add_argument("--refresh-download", action="store_true", help="Re-download even if ZIP already exists")
    parser.add_argument("--local-only", action="store_true", help="Do not download; process the local archive")
    args = parser.parse_args()
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    try:
        manifest = run(args.url, args.archive, args.output, refresh_download=args.refresh_download or not args.local_only)
    except (requests.RequestException, OSError, ValueError, zipfile.BadZipFile) as exc:
        LOG.error("UN Tourism bulk import failed: %s", exc)
        return 1
    print(json.dumps({"archive": manifest["meta"]["archive"], "workbooks": manifest["meta"]["workbook_count"],
                      "worksheets": manifest["meta"]["worksheet_count"], "manifest": str(args.output / "manifest.json")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())