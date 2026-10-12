#!/usr/bin/env python3
"""Fetch UN Comtrade product imports and World Bank context for GPIR."""
from __future__ import annotations

import bisect
import json
import logging
import math
import os
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
CONFIG_DIR = ROOT / "config"
OUTPUT = DATA_DIR / "data.json"
COMTRADE_REFERENCE_URL = "https://comtradeapi.un.org/files/v1/app/reference/Reporters.json"

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("gpir")


def session_with_retries() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=4, backoff_factor=0.8, status_forcelist=(429, 500, 502, 503, 504), allowed_methods=("GET",))
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update({"User-Agent": "GlobalProductIntelligenceRadar/1.0 (open-data research project)"})
    return session


def fetch_json(session: requests.Session, url: str, params: dict[str, Any] | None = None, timeout: int = 45, headers: dict[str, str] | None = None) -> Any:
    response = session.get(url, params=params, headers=headers, timeout=timeout)
    response.raise_for_status()
    return response.json()


def as_float(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def load_markets() -> list[str]:
    override = os.getenv("MARKET_ISO3", "").strip()
    if override:
        return sorted({code.strip().upper() for code in override.split(",") if code.strip()})
    with (CONFIG_DIR / "markets.json").open(encoding="utf-8") as fh:
        return sorted({code.upper() for code in json.load(fh).get("markets", [])})


def get_year_range() -> list[int]:
    current_year = datetime.now(timezone.utc).year
    end_year = int(os.getenv("COMTRADE_END_YEAR", str(current_year - 2)))
    start_year = int(os.getenv("COMTRADE_START_YEAR", str(end_year - 3)))
    if start_year > end_year or end_year > current_year:
        raise ValueError("Invalid Comtrade year range")
    return list(range(start_year, end_year + 1))


def get_reporter_reference(session: requests.Session) -> dict[str, dict[str, Any]]:
    payload = fetch_json(session, COMTRADE_REFERENCE_URL)
    results = payload.get("results", []) if isinstance(payload, dict) else []
    mapping: dict[str, dict[str, Any]] = {}
    for row in results:
        iso3 = str(row.get("reporterCodeIsoAlpha3", "")).strip().upper()
        if len(iso3) != 3 or row.get("isGroup") or row.get("entryExpiredDate"):
            continue
        try:
            code = int(row.get("reporterCode"))
        except (TypeError, ValueError):
            continue
        mapping[iso3] = {"reporter_code": code, "name": str(row.get("reporterDesc") or row.get("text") or iso3)}
    if not mapping:
        raise RuntimeError("UN Comtrade reporters reference has no usable countries")
    return mapping


def fetch_trade_rows(session: requests.Session, reporter_code: int, year: int, api_key: str, max_records: int) -> tuple[list[dict[str, Any]], str]:
    if api_key:
        url = "https://comtradeapi.un.org/data/v1/get/C/A/HS"
        params = {
            "reporterCode": reporter_code, "partnerCode": 0, "flowCode": "M",
            "period": year, "maxrecords": max_records, "includeDesc": "true",
        }
        # UN Comtrade's API portal documents this subscription-key header.
        headers = {"Ocp-Apim-Subscription-Key": api_key}
        mode = "live"
    else:
        url = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
        params = {"reporterCode": reporter_code, "partnerCode": 0, "flowCode": "M",
                  "period": year, "maxrecords": min(max_records, 500), "includeDesc": "true"}
        headers = None
        mode = "preview"
    payload = fetch_json(session, url, params=params, headers=headers)
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        raise RuntimeError(f"Unexpected Comtrade payload for reporter {reporter_code}, year {year}")
    return rows, mode


def classification_rank(row: dict[str, Any]) -> int:
    code = str(row.get("classificationCode") or "").upper()
    return int(code[1]) if len(code) == 2 and code.startswith("H") and code[1].isdigit() else -1


def percentile_map(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    ordered = sorted(values.values())
    if len(ordered) == 1:
        return {key: 50.0 for key in values}
    return {key: ((bisect.bisect_left(ordered, val) + bisect.bisect_right(ordered, val) - 1) / 2) / (len(ordered) - 1) * 100 for key, val in values.items()}


def safe_cagr(first_value: float, latest_value: float, years_between: int) -> float | None:
    if first_value <= 0 or latest_value < 0 or years_between <= 0:
        return None
    try:
        return (math.pow(latest_value / first_value, 1 / years_between) - 1) * 100
    except (ValueError, OverflowError, ZeroDivisionError):
        return None


def build_items(raw_by_market_year: dict[tuple[str, int], list[dict[str, Any]]], reporter_lookup: dict[str, dict[str, Any]], country_context: dict[str, dict[str, Any]], years: list[int], mode: str) -> list[dict[str, Any]]:
    observations: dict[tuple[str, str], dict[int, dict[str, Any]]] = defaultdict(dict)
    names: dict[str, str] = {}
    dedup: dict[tuple[str, int, str], dict[str, Any]] = {}
    for (iso3, year), rows in raw_by_market_year.items():
        for row in rows:
            raw_code = str(row.get("cmdCode") or "").strip()
            if not raw_code.isdigit() or len(raw_code) not in (5, 6):
                continue
            code = raw_code.zfill(6)
            value = as_float(row.get("primaryValue"))
            if value is None or value < 0:
                continue
            key = (iso3, year, code)
            if key not in dedup or classification_rank(row) > classification_rank(dedup[key]):
                dedup[key] = row
    for (iso3, year, code), row in dedup.items():
        observations[(iso3, code)][year] = {
            "year": year, "import_value_usd": as_float(row.get("primaryValue")),
            "net_weight_kg": as_float(row.get("netWgt")), "quantity": as_float(row.get("qty")),
        }
        desc = str(row.get("cmdDesc") or row.get("cmdDescE") or "").strip()
        if desc:
            names.setdefault(code, desc)
    provisional = []
    for (iso3, code), by_year in observations.items():
        series = sorted(by_year.values(), key=lambda item: item["year"])
        if not any((point["import_value_usd"] or 0) > 0 for point in series):
            continue
        country, reporter = country_context.get(iso3, {}), reporter_lookup.get(iso3, {})
        latest = series[-1]
        previous = by_year.get(int(latest["year"]) - 1)
        latest_value = latest["import_value_usd"]
        previous_value = previous["import_value_usd"] if previous else None
        yoy = (latest_value / previous_value - 1) * 100 if latest_value is not None and previous_value is not None and previous_value > 0 else None
        comparisons = positive = streak = 0
        for left, right in zip(series, series[1:]):
            if right["year"] == left["year"] + 1 and left["import_value_usd"] is not None and left["import_value_usd"] > 0 and right["import_value_usd"] is not None:
                comparisons += 1
                positive += int(right["import_value_usd"] > left["import_value_usd"])
        for left, right in reversed(list(zip(series, series[1:]))):
            if right["year"] != left["year"] + 1 or left["import_value_usd"] is None or left["import_value_usd"] <= 0 or right["import_value_usd"] is None or right["import_value_usd"] <= left["import_value_usd"]:
                break
            streak += 1
        positives = [point for point in series if point["import_value_usd"] is not None and point["import_value_usd"] > 0]
        cagr = safe_cagr(positives[0]["import_value_usd"], positives[-1]["import_value_usd"], int(positives[-1]["year"]) - int(positives[0]["year"])) if len(positives) >= 2 else None
        provisional.append({
            "id": f"{iso3}-{code}", "product_code": code, "product_name": names.get(code, f"HS {code}"),
            "classification": "HS-6 (review classification revision metadata)",
            "market_iso3": iso3, "market_name": country.get("name") or reporter.get("name") or iso3,
            "reporter_code": reporter.get("reporter_code"), "market_latitude": country.get("latitude"),
            "market_longitude": country.get("longitude"), "latest_year": int(latest["year"]),
            "latest_import_usd": max(0.0, latest_value or 0.0),
            "previous_year": int(latest["year"]) - 1 if previous else None, "previous_import_usd": previous_value,
            "yoy_growth_pct": yoy, "cagr_pct": cagr, "positive_growth_years": positive,
            "growth_comparisons_available": comparisons, "positive_growth_streak": streak,
            "gdp_per_capita_usd": country.get("gdp_per_capita_usd"), "gdp_per_capita_year": country.get("gdp_per_capita_year"),
            "population": country.get("population"), "population_year": country.get("population_year"), "series": series,
            "opportunity_score": None, "score_coverage_pct": 0,
            "score_label": "Exploratory trade signal, not a sales forecast",
            "source_name": "UN Comtrade", "source_url": "https://comtradeplus.un.org/",
            "source_endpoint": "data/v1/get/C/A/HS" if mode == "live" else "public/v1/preview/C/A/HS", "data_mode": mode,
        })
    size = {r["id"]: math.log1p(r["latest_import_usd"]) for r in provisional if r["latest_import_usd"] > 0}
    growth = {r["id"]: max(-100.0, min(300.0, float(r["yoy_growth_pct"]))) for r in provisional if r["yoy_growth_pct"] is not None and math.isfinite(float(r["yoy_growth_pct"]))}
    consistency = {r["id"]: r["positive_growth_years"] / r["growth_comparisons_available"] * 100 for r in provisional if r["growth_comparisons_available"] > 0}
    macro = {r["id"]: math.log1p(r["gdp_per_capita_usd"]) for r in provisional if r["gdp_per_capita_usd"] is not None and r["gdp_per_capita_usd"] > 0}
    ranks = {name: percentile_map(values) for name, values in (("size", size), ("growth", growth), ("consistency", consistency), ("macro", macro))}
    weights = {"growth": 40.0, "size": 35.0, "consistency": 15.0, "macro": 10.0}
    for row in provisional:
        parts = []
        for dimension, weight in weights.items():
            rank = ranks[dimension].get(row["id"])
            if rank is not None:
                parts.append((rank, weight))
        total = sum(weight for _, weight in parts)
        if total and row["yoy_growth_pct"] is not None:
            row["opportunity_score"] = round(sum(score * weight for score, weight in parts) / total, 1)
            row["score_coverage_pct"] = round(total, 1)
    return sorted(provisional, key=lambda item: (item["opportunity_score"] is not None, item["opportunity_score"] or -1), reverse=True)


def main() -> int:
    session = session_with_retries()
    api_key = os.getenv("COMTRADE_API_KEY", "").strip()
    markets = load_markets()
    years = get_year_range()
    max_records = int(os.getenv("COMTRADE_MAX_RECORDS", "100000" if api_key else "500"))
    if not api_key:
        max_records = min(max_records, 500)
        log.warning("No COMTRADE_API_KEY: public preview mode is limited and may be truncated.")
    else:
        log.info("COMTRADE_API_KEY detected; using the authenticated UN Comtrade endpoint.")
    reporter_reference = get_reporter_reference(session)
    selected = {iso: reporter_reference[iso] for iso in markets if iso in reporter_reference}
    unresolved = sorted(set(markets) - set(selected))
    if unresolved:
        log.warning("Could not resolve reporter codes for: %s", ", ".join(unresolved))
    if not selected:
        raise RuntimeError("No requested ISO-3 values resolve to UN Comtrade reporters")
    # Keep the scheduled Python collector focused on the quota-limited trade source.
    # Public macro context is loaded directly by the browser in market-context.js.
    countries = {
        iso: {
            "iso3": iso, "name": reporter["name"],
            "latitude": None, "longitude": None, "region": None, "income_level": None,
            "gdp_per_capita_usd": None, "gdp_per_capita_year": None,
            "population": None, "population_year": None,
        }
        for iso, reporter in selected.items()
    }
    raw: dict[tuple[str, int], list[dict[str, Any]]] = {}
    failures = []
    mode = "live" if api_key else "preview"
    calls = 0
    for iso, reporter in selected.items():
        for year in years:
            try:
                rows, call_mode = fetch_trade_rows(session, reporter["reporter_code"], year, api_key, max_records)
                raw[(iso, year)] = rows
                calls += 1
                if call_mode == "preview":
                    mode = "preview"
                log.info("Fetched %s/%s: %d rows", iso, year, len(rows))
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                failures.append(f"{iso}/{year}: {exc}")
                log.warning("Failed %s/%s: %s", iso, year, exc)
            time.sleep(max(0, float(os.getenv("REQUEST_SLEEP_SECONDS", "0.15"))))
    if not raw:
        raise RuntimeError("All Comtrade requests failed; old data.json is preserved")
    items = build_items(raw, selected, countries, years, mode)
    if not items:
        raise RuntimeError("No six-digit product records returned; old data.json is preserved")
    participating = sorted({item["market_iso3"] for item in items})
    output = {
        "schema_version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meta": {
            "project": "Global Product Intelligence Radar", "mode": mode,
            "status": "preview-limited" if mode == "preview" else "live-data-fetched",
            "years_requested": years, "markets_requested": len(selected), "markets_with_data": len(participating),
            "market_iso3_covered": participating, "successful_comtrade_calls": calls, "failed_comtrade_calls": failures,
            "raw_trade_rows": sum(len(rows) for rows in raw.values()), "product_market_rows": len(items),
            "trade_unit": "reported import value USD, UN Comtrade primaryValue",
            "sources": [{"name": "UN Comtrade", "url": "https://comtradeplus.un.org/", "role": "Merchandise trade; quota-limited scheduled collection, not retail sales"}],
            "frontend_context": {"name": "World Bank Indicators API v2", "url": "https://api.worldbank.org/v2/", "role": "Browser-side country coordinates and macro context; not stored in the trade feed"},
            "score_method": "Percentile composite v1: 40% import growth, 35% latest value, 15% growth consistency, 10% GDP per capita; weights renormalized for available inputs.",
            "limitations": ["Selected reporters only; this is not complete global coverage.", "Import data are not retail sell-through, sales, or profit.", "Missing observations and HS classification revisions can affect trends.", "Preview data may be truncated."],
            "api_key_configured": bool(api_key)
        },
        "countries": [countries[iso] for iso in participating if iso in countries], "items": items
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = OUTPUT.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    tmp.replace(OUTPUT)
    log.info("Wrote %d product-market rows for %d markets (%s)", len(items), len(participating), mode)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log.exception("GPIR refresh failed: %s", exc)
        raise SystemExit(1)
