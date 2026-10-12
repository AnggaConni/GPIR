# UN Tourism Bulk Statistics Import

GPIR has a dedicated importer for the official UN Tourism bulk ZIP archive. It runs separately from the tourism-place collector because official tourism statistics and mapped attractions are different evidence types.

## Pipeline

`pipeline/import_un_tourism_bulk.py` downloads the configured ZIP, validates the archive, extracts files safely, reads `.xlsx`/`.xlsm` worksheets with `openpyxl`, and exports each non-empty sheet to JSON. It preserves worksheet cells as a two-dimensional `data` grid so multi-row headings, footnotes and tables are not guessed or flattened incorrectly.

Outputs:

- `data/un_tourism/manifest.json` — source archive, retrieval time, workbook/sheet counts and caveats.
- `data/un_tourism/sheets/*.json` — one JSON per worksheet, with provenance and row/column metadata.
- `data/un_tourism/extracted/` — extracted source workbooks used for conversion.

The archive is saved locally to `data/source_archives/` during a workflow run but is not published in the commit allowlist; only JSON results and the manifest are committed. This avoids needlessly storing the whole ZIP in the website repository.

## Run locally

```bash
python -m pip install -r requirements.txt
python pipeline/import_un_tourism_bulk.py --refresh-download
```

To convert an already-downloaded archive without network access:

```bash
python pipeline/import_un_tourism_bulk.py --local-only --archive path/to/archive.zip
```

By default the importer downloads the May 2026 public archive supplied for this integration. To change its URL, use `--url` or set `UN_TOURISM_BULK_URL`.

## GitHub Actions

The weekly data-refresh workflow runs the importer and commits generated JSON under `data/un_tourism/`. The optional repository Actions variable `UN_TOURISM_BULK_URL` can override the default archive URL. The workflow downloads the archive into the runner, and does not commit the ZIP itself.

## Important interpretation notes

- This is a snapshot of the specified archive version, not a live API.
- Worksheet structures are not automatically normalized to a single universal table. Each worksheet can have different headings, dimensions, units, and footnotes.
- Before using the records for charts, parse the worksheet header structure and verify each indicator's unit, country/area code, year, and missing-value convention.
- Country-level arrivals or tourism receipts must not be described as visits to an individual attraction or local footfall.
- Preserve official attribution, source links and any data-use requirements that apply to the downloaded archive.
