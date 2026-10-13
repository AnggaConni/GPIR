#!/usr/bin/env python3
"""Build a compact bilateral import-flow snapshot for the GPIR SVG trade map.

Each row is based on an import report: the reporter is the buyer/importing
market and the partner is the declared origin/supplier. This does not identify
individual companies and is not a complete census of all world trade.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
INPUT = DATA_DIR / "data.json"
OUTPUT = DATA_DIR / "trade_flows.json"
REFERENCE_URL = "https://comtradeapi.un.org/files/v1/app/reference/Reporters.json"
SOURCE_URL = "https://comtradeplus.un.org/"

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("gpir-trade-flows")


def make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=4, backoff_factor=0.8, status_forcelist=(429, 500, 502, 503, 504), allowed_methods=("GET",))
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update({"User-Agent": "GlobalProductIntelligenceRadar/1.0 (open-data research project)"})
    return session


def as_float(value: Any) -> float | None:
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else None
    except (TypeError, ValueError):
        return None


def valid_iso3(value: Any) -> bool:
    iso = str(value or "").strip().upper()
    return bool(re.fullmatch(r"[A-Z]{3}", iso)) and iso not in {"W00", "UNK"}


def normalise_hs_code(value: Any) -> str | None:
    code = str(value or "").strip()
    if not code.isdigit() or len(code) not in (5, 6):
        return None
    return code.zfill(6)


def choose_product_targets(snapshot: dict[str, Any], product_limit: int = 8) -> dict[str, dict[str, Any]]:
    """Pick high-value six-digit product codes per reporter for the latest year."""
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    items = snapshot.get("items", []) if isinstance(snapshot, dict) else []
    for item in items if isinstance(items, list) else []:
        iso = str(item.get("market_iso3") or "").strip().upper()
        year = item.get("latest_year")
        code = normalise_hs_code(item.get("product_code") or item.get("hs_code"))
        value = as_float(item.get("latest_import_usd"))
        if valid_iso3(iso) and code and year is not None and value is not None and value > 0:
            grouped[iso].append({"year": int(year), "code": code, "value": value, "name": str(item.get("product_name") or ("HS " + code))})
    targets: dict[str, dict[str, Any]] = {}
    for iso, rows in grouped.items():
        latest_year = max(row["year"] for row in rows)
        latest_rows = [row for row in rows if row["year"] == latest_year]
        by_code: dict[str, dict[str, Any]] = {}
        for row in latest_rows:
            current = by_code.get(row["code"])
            if current is None or row["value"] > current["value"]:
                by_code[row["code"]] = row
        selected = sorted(by_code.values(), key=lambda row: row["value"], reverse=True)[:max(1, product_limit)]
        if selected:
            targets[iso] = {
                "year": latest_year,
                "codes": [row["code"] for row in selected],
                "names": {row["code"]: row["name"] for row in selected},
            }
    return targets


def fetch_reporters(session: requests.Session) -> dict[str, dict[str, Any]]:
    response = session.get(REFERENCE_URL, timeout=45)
    response.raise_for_status()
    payload = response.json()
    result: dict[str, dict[str, Any]] = {}
    for row in payload.get("results", []) if isinstance(payload, dict) else []:
        iso = str(row.get("reporterCodeIsoAlpha3") or "").strip().upper()
        code = row.get("reporterCode")
        if not valid_iso3(iso) or row.get("isGroup") or row.get("entryExpiredDate"):
            continue
        try:
            numeric_code = int(code)
        except (TypeError, ValueError):
            continue
        result[iso] = {"reporter_code": numeric_code, "name": str(row.get("reporterDesc") or row.get("text") or iso)}
    if not result:
        raise RuntimeError("UN Comtrade reporter reference returned no usable countries")
    return result


def fetch_import_rows(
    session: requests.Session,
    reporter_code: int,
    year: int,
    product_codes: list[str],
    api_key: str,
    max_records: int,
) -> tuple[list[dict[str, Any]], str]:
    if not product_codes:
        return [], "live" if api_key else "preview"
    if api_key:
        url = "https://comtradeapi.un.org/data/v1/get/C/A/HS"
        headers = {"Ocp-Apim-Subscription-Key": api_key}
        mode = "live"
    else:
        url = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
        headers = {}
        mode = "preview"
    params = {
        "reporterCode": reporter_code,
        "partnerCode": "ALL",
        "flowCode": "M",
        "period": year,
        "cmdCode": ",".join(product_codes[:20]),
        "maxrecords": max_records if api_key else min(max_records, 500),
        "includeDesc": "true",
    }
    response = session.get(url, params=params, headers=headers, timeout=60)
    response.raise_for_status()
    payload = response.json()
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        raise RuntimeError(f"Unexpected UN Comtrade payload for reporter {reporter_code}, year {year}")
    return rows, mode


def build_flow_records(
    rows: list[dict[str, Any]],
    buyer_iso3: str,
    buyer_name: str,
    requested_year: int,
) -> list[dict[str, Any]]:
    """Transform partner-level import observations into supplier -> buyer edges."""
    dedup: dict[tuple[str, str, str, int], dict[str, Any]] = {}
    for row in rows:
        supplier_iso = str(row.get("partnerISO") or row.get("partnerIso") or "").strip().upper()
        partner_code = str(row.get("partnerCode") or "").strip()
        partner_name = str(row.get("partnerDesc") or row.get("partnerName") or supplier_iso or "Unknown partner").strip()
        # Partner code 0 / ISO W00 is the world aggregate, not a bilateral edge.
        if partner_code == "0" or supplier_iso in {"W00", "WORLD", "UNK"} or not valid_iso3(supplier_iso):
            continue
        product_code = normalise_hs_code(row.get("cmdCode"))
        value = as_float(row.get("primaryValue"))
        if not product_code or value is None or value <= 0:
            continue
        try:
            year = int(row.get("period") or row.get("refYear") or requested_year)
        except (TypeError, ValueError):
            year = requested_year
        key = (supplier_iso, buyer_iso3, product_code, year)
        record = {
            "id": f"{supplier_iso}-{buyer_iso3}-{product_code}-{year}",
            "supplier_iso3": supplier_iso,
            "supplier_name": partner_name,
            "buyer_iso3": buyer_iso3,
            "buyer_name": buyer_name,
            "product_code": product_code,
            "product_name": str(row.get("cmdDesc") or row.get("cmdDescE") or ("HS " + product_code)).strip(),
            "year": year,
            "import_value_usd": value,
            "quantity": as_float(row.get("qty")),
            "net_weight_kg": as_float(row.get("netWgt")),
            "source_name": "UN Comtrade",
            "source_url": SOURCE_URL,
            "evidence_type": "reported_import_by_partner",
            "interpretation": "Buyer-reported import; partner is the declared origin, not a named supplier company.",
        }
        previous = dedup.get(key)
        # Some releases include repeated observations under different HS revisions.
        if previous is None or value > previous["import_value_usd"]:
            dedup[key] = record
    return list(dedup.values())


def atomic_write(payload: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".json.tmp")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temp.replace(OUTPUT)


def main() -> int:
    if not INPUT.exists():
        raise FileNotFoundError(f"Main trade snapshot not found: {INPUT}")
    snapshot = json.loads(INPUT.read_text(encoding="utf-8"))
    api_key = os.getenv("COMTRADE_API_KEY", "").strip()
    preview_limit = max(1, int(os.getenv("COMTRADE_FLOW_PRODUCTS_PER_MARKET", "2" if not api_key else "8")))
    max_records = max(500, int(os.getenv("COMTRADE_FLOW_MAX_RECORDS", "50000")))
    targets = choose_product_targets(snapshot, preview_limit)
    if not targets:
        raise RuntimeError("No product-market rows are available to build bilateral trade flows")

    session = make_session()
    reporters = fetch_reporters(session)
    known_markets = {
        str(row.get("iso3") or "").upper(): row
        for row in snapshot.get("countries", [])
        if isinstance(row, dict) and valid_iso3(row.get("iso3"))
    }
    all_flows: dict[str, dict[str, Any]] = {}
    failures: list[str] = []
    successes = 0
    mode = "live" if api_key else "preview"
    pause = max(0.0, float(os.getenv("REQUEST_SLEEP_SECONDS", "0.2" if api_key else "1.0")))

    for buyer_iso, target in targets.items():
        reporter = reporters.get(buyer_iso)
        if not reporter:
            failures.append(f"{buyer_iso}: reporter code could not be resolved")
            continue
        buyer_name = str(known_markets.get(buyer_iso, {}).get("name") or reporter["name"])
        try:
            rows, call_mode = fetch_import_rows(
                session, reporter["reporter_code"], target["year"], target["codes"], api_key, max_records
            )
            successes += 1
            if call_mode == "preview":
                mode = "preview"
            allowed_codes = set(target["codes"])
            for flow in build_flow_records(rows, buyer_iso, buyer_name, target["year"]):
                if flow["product_code"] in allowed_codes:
                    all_flows[flow["id"]] = flow
            log.info("Fetched bilateral imports for %s/%s: %d raw rows, %d retained products",
                     buyer_iso, target["year"], len(rows),
                     sum(1 for f in all_flows.values() if f["buyer_iso3"] == buyer_iso))
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            failures.append(f"{buyer_iso}/{target['year']}: {exc}")
            log.warning("Failed bilateral imports for %s/%s: %s", buyer_iso, target["year"], exc)
        time.sleep(pause)

    if successes == 0:
        raise RuntimeError("All bilateral trade requests failed; existing trade_flows.json was preserved")

    flows = sorted(all_flows.values(), key=lambda flow: flow["import_value_usd"], reverse=True)
    buyer_markets = sorted({flow["buyer_iso3"] for flow in flows})
    supplier_markets = sorted({flow["supplier_iso3"] for flow in flows})
    payload = {
        "schema_version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meta": {
            "project": "Global Product Intelligence Radar",
            "mode": mode,
            "status": "preview-limited" if mode == "preview" else "live-data-fetched",
            "source": "UN Comtrade",
            "source_url": SOURCE_URL,
            "flow_semantics": "Reported imports: partner country (declared origin) -> reporter country (buyer/importer).",
            "years_by_buyer": {iso: target["year"] for iso, target in targets.items()},
            "product_limit_per_market": preview_limit,
            "markets_requested": len(targets),
            "markets_with_flows": len(buyer_markets),
            "supplier_countries": len(supplier_markets),
            "successful_requests": successes,
            "failed_requests": failures,
            "flow_rows": len(flows),
            "api_key_configured": bool(api_key),
            "preview_warning": "Without an API key, the public preview is capped at 500 records per request and route coverage may be truncated." if not api_key else None,
            "limitations": [
                "Only the configured reporting markets are queried as buyers.",
                "Only each market's selected top products are queried for this map snapshot.",
                "Partner names represent declared trade origins, not verified supplier companies.",
                "Import and mirror export statistics can differ; routes are based on the importer's reported data.",
                "Trade values are not retail sales or proof of current buyer demand.",
            ],
        },
        "flows": flows,
    }
    atomic_write(payload)
    log.info("Wrote %d bilateral product flows involving %d buyers and %d supplier markets (%s)",
             len(flows), len(buyer_markets), len(supplier_markets), mode)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log.exception("GPIR bilateral flow refresh failed: %s", exc)
        raise SystemExit(1)
