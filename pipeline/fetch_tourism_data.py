#!/usr/bin/env python3
"""Build scheduled tourism, travel-guide, heritage and food-catalogue snapshots for GPIR.

Dynamic user-nearby place detection remains an on-demand OpenStreetMap operation in
the browser because GitHub Pages is static. This scheduled collector builds reusable
background snapshots and never stores a visitor's precise location.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CONFIG_DIR = ROOT / "config"
USER_AGENT = "GlobalProductIntelligenceRadar/1.0 (+https://github.com/AnggaConni/GPIR; open-data research project)"
OSM_OVERPASS = "https://overpass-api.de/api/interpreter"
UNESCO_API = "https://data.unesco.org/api/explore/v2.1/catalog/datasets/ich001/records"
UNESCO_DESIGNATED_API = "https://data.unesco.org/api/explore/v2.1/catalog/datasets/{dataset}/records"
UNESCO_DESIGNATED_DATASETS = (
    {
        "dataset": "whc001", "category": "world_heritage",
        "designation": "UNESCO World Heritage Site",
        "dataset_url": "https://data.unesco.org/explore/dataset/whc001/api/",
        "license": "CC BY-SA 4.0",
    },
    {
        "dataset": "eg0001", "category": "geopark",
        "designation": "UNESCO Global Geopark",
        "dataset_url": "https://data.unesco.org/explore/dataset/eg0001/api/",
        "license": "CC BY-SA 4.0",
    },
    {
        "dataset": "mab001", "category": "biosphere_reserve",
        "designation": "UNESCO Biosphere Reserve",
        "dataset_url": "https://data.unesco.org/explore/dataset/mab001/api/",
        "license": "CC BY-SA 4.0",
    },
)
WORLD_BANK_API = "https://api.worldbank.org/v2"
OPENFOODFACTS_SEARCH = "https://world.openfoodfacts.org/cgi/search.pl"
OPENTRIPMAP_RADIUS = "https://api.opentripmap.com/0.1/en/places/radius"
logger = logging.getLogger("gpir.tourism")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def session_with_retries() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=1.0, status_forcelist=(429, 500, 502, 503, 504), allowed_methods=("GET",), respect_retry_after_header=True)
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
    return session


def fetch_json(session: requests.Session, url: str, params: dict[str, Any] | None = None, timeout: int = 40) -> Any:
    response = session.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    tmp.replace(path)


def read_existing(path: Path) -> dict[str, Any] | None:
    try:
        with path.open(encoding="utf-8") as fh:
            payload = json.load(fh)
        return payload if isinstance(payload, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def as_float(value: Any) -> float | None:
    try:
        out = float(value)
        return out if math.isfinite(out) else None
    except (TypeError, ValueError):
        return None


def first_text(row: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return ""


def flatten_names(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "; ".join(filter(None, (flatten_names(item) for item in value)))
    if isinstance(value, dict):
        for key in ("name_en", "name", "label", "en", "country"):
            if value.get(key):
                return flatten_names(value[key])
        return "; ".join(filter(None, (flatten_names(item) for item in value.values())))
    return ""


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0088
    r = math.pi / 180
    dlat, dlon = (lat2 - lat1) * r, (lon2 - lon1) * r
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin(dlon / 2) ** 2
    return radius * 2 * math.asin(math.sqrt(min(1.0, max(0.0, a))))


def load_config() -> tuple[list[dict[str, Any]], list[str]]:
    with (CONFIG_DIR / "tourism_areas.json").open(encoding="utf-8") as fh:
        area_config = json.load(fh)
    with (CONFIG_DIR / "food_search_terms.json").open(encoding="utf-8") as fh:
        food_config = json.load(fh)
    areas = area_config.get("areas", [])
    terms = food_config.get("terms", [])
    for area in areas:
        if not area.get("id") or as_float(area.get("lat")) is None or as_float(area.get("lon")) is None:
            raise ValueError("Every tourism seed area needs id, lat and lon")
    return areas, [str(term).strip() for term in terms if str(term).strip()]


def normalise_tourism_kind(kinds: str) -> str:
    text = str(kinds or "").lower()
    if any(word in text for word in ("museum", "historic", "archaeolog", "monument", "castle", "memorial", "cultural")):
        return "cultural_attraction"
    if any(word in text for word in ("craft", "gallery", "art", "handicraft")):
        return "arts_and_crafts"
    if any(word in text for word in ("beach", "waterfall", "park", "natural", "national_park", "cave")):
        return "nature_attraction"
    if any(word in text for word in ("viewpoint", "amusement", "zoo", "aquarium", "theme_park", "attraction")):
        return "visitor_attraction"
    return "point_of_interest"


def normalise_opentripmap(row: dict[str, Any], seed: dict[str, Any]) -> dict[str, Any] | None:
    point = row.get("point") if isinstance(row.get("point"), dict) else {}
    lat, lon = as_float(point.get("lat")), as_float(point.get("lon"))
    xid = first_text(row, ("xid",))
    name = first_text(row, ("name",))
    if not xid or not name or lat is None or lon is None:
        return None
    kinds = first_text(row, ("kinds",))
    dist_m = as_float(row.get("dist"))
    return {
        "id": "opentripmap:" + xid, "source": "OpenTripMap", "kind": "tourist_attraction",
        "category": normalise_tourism_kind(kinds), "name": name, "lat": lat, "lon": lon,
        "distance_from_seed_km": round(dist_m / 1000, 3) if dist_m is not None else round(haversine_km(seed["lat"], seed["lon"], lat, lon), 3),
        "seed_area_id": seed["id"], "seed_area_name": seed["name"],
        "external_id": xid, "kinds": kinds, "rate": row.get("rate"),
        "wikidata": row.get("wikidata"), "osm": row.get("osm"),
        "url": "https://opentripmap.com/en/card/" + xid,
        "source_url": "https://dev.opentripmap.org/product", "license": "ODbL 1.0",
        "evidence_type": "mapped_attraction", "retrieved_at": utc_now()
    }


def collect_opentripmap(session: requests.Session, areas: list[dict[str, Any]], api_key: str,
                        radius_m: int = 15000, limit: int = 60, sleep_seconds: float = 0.25) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not api_key:
        return [], {"status": "skipped_missing_api_key", "records": 0, "message": "Set GitHub Actions secret OPENTRIPMAP_API_KEY to enable this source."}
    records: list[dict[str, Any]] = []
    failures: list[str] = []
    for i, area in enumerate(areas):
        try:
            payload = fetch_json(session, OPENTRIPMAP_RADIUS, {
                "lat": area["lat"], "lon": area["lon"], "radius": radius_m,
                "limit": limit, "kinds": "interesting_places", "format": "json", "apikey": api_key
            })
            rows = payload if isinstance(payload, list) else []
            records.extend(item for row in rows if isinstance(row, dict) and (item := normalise_opentripmap(row, area)))
            logger.info("OpenTripMap: %s returned %d usable records", area["id"], len(rows))
        except (requests.RequestException, ValueError, TypeError) as exc:
            failures.append(f"{area['id']}: {type(exc).__name__}")
            logger.warning("OpenTripMap request failed for %s: %s", area["id"], type(exc).__name__)
        if i < len(areas) - 1:
            time.sleep(max(0, sleep_seconds))
    status = "ok" if records and not failures else "partial" if records else "failed"
    return records, {"status": status, "records": len(records), "failed_areas": failures, "license": "ODbL 1.0"}


def normalize_wikivoyage(row: dict[str, Any], seed: dict[str, Any], lang: str) -> dict[str, Any] | None:
    title = first_text(row, ("title",))
    lat, lon = as_float(row.get("lat")), as_float(row.get("lon"))
    if not title or lat is None or lon is None:
        return None
    page_id = str(row.get("pageid") or re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"))
    page_url = "https://" + lang + ".wikivoyage.org/wiki/" + requests.utils.quote(title.replace(" ", "_"), safe="()_-")
    return {
        "id": f"wikivoyage:{lang}:{page_id}", "source": "Wikivoyage", "kind": "travel_guide",
        "category": "travel_guide", "name": title, "lat": lat, "lon": lon,
        "distance_from_seed_km": round(haversine_km(seed["lat"], seed["lon"], lat, lon), 3),
        "seed_area_id": seed["id"], "seed_area_name": seed["name"],
        "external_id": page_id, "url": page_url,
        "source_url": "https://" + lang + ".wikivoyage.org/",
        "license": "CC BY-SA; title/coordinate metadata only, no article body copied",
        "evidence_type": "travel_guide_metadata", "retrieved_at": utc_now()
    }


def collect_wikivoyage(session: requests.Session, areas: list[dict[str, Any]], radius_m: int = 10000,
                        limit: int = 15, sleep_seconds: float = 0.8) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records: list[dict[str, Any]] = []
    failures: list[str] = []
    for i, area in enumerate(areas):
        lang = str(area.get("language") or "en").lower()
        url = f"https://{lang}.wikivoyage.org/w/api.php"
        try:
            payload = fetch_json(session, url, {
                "action": "query", "list": "geosearch",
                "gscoord": f"{area['lat']}|{area['lon']}",
                "gsradius": min(10000, radius_m), "gslimit": min(50, limit),
                "format": "json", "formatversion": 2
            })
            rows = payload.get("query", {}).get("geosearch", []) if isinstance(payload, dict) else []
            records.extend(item for row in rows if isinstance(row, dict) and (item := normalize_wikivoyage(row, area, lang)))
        except (requests.RequestException, ValueError, TypeError) as exc:
            failures.append(f"{area['id']}: {type(exc).__name__}")
            logger.warning("Wikivoyage request failed for %s: %s", area["id"], type(exc).__name__)
        if i < len(areas) - 1:
            time.sleep(max(0, sleep_seconds))
    status = "ok" if records and not failures else "partial" if records else "failed"
    return records, {"status": status, "records": len(records), "failed_areas": failures,
                     "license": "Wikivoyage content CC BY-SA; only title/coordinate metadata stored"}


TOURISM_TAGS = "attraction|museum|gallery|viewpoint|theme_park|zoo|aquarium|artwork|picnic_site"


def normalize_osm_element(row: dict[str, Any], seed: dict[str, Any]) -> dict[str, Any] | None:
    tags = row.get("tags") if isinstance(row.get("tags"), dict) else {}
    lat = as_float(row.get("lat", (row.get("center") or {}).get("lat")))
    lon = as_float(row.get("lon", (row.get("center") or {}).get("lon")))
    name = first_text(tags, ("name", "brand", "operator"))
    if lat is None or lon is None or not name:
        return None
    tourism_tag = str(tags.get("tourism") or "").lower()
    historic_tag = str(tags.get("historic") or "").lower()
    craft = str(tags.get("craft") or "").lower()
    shop = str(tags.get("shop") or "").lower()
    if tourism_tag in TOURISM_TAGS.split("|") or historic_tag in ("monument", "memorial", "ruins", "castle", "archaeological_site"):
        kind, category = "tourist_attraction", "cultural_attraction" if historic_tag else normalise_tourism_kind(tourism_tag)
    elif craft:
        kind, category = "local_craft_business", "arts_and_crafts"
    elif shop in ("gift", "souvenir", "art", "craft"):
        kind, category = "souvenir_shop", "arts_and_crafts"
    else:
        return None
    osm_type = str(row.get("type") or "node")
    osm_id = str(row.get("id") or "")
    return {
        "id": f"osm:{osm_type}:{osm_id}", "source": "OpenStreetMap", "kind": kind, "category": category,
        "name": name, "lat": lat, "lon": lon,
        "distance_from_seed_km": round(haversine_km(seed["lat"], seed["lon"], lat, lon), 3),
        "seed_area_id": seed["id"], "seed_area_name": seed["name"],
        "external_id": osm_type + "/" + osm_id, "url": f"https://www.openstreetmap.org/{osm_type}/{osm_id}",
        "source_url": "https://www.openstreetmap.org/copyright", "license": "ODbL 1.0",
        "tags": {key: tags[key] for key in ("tourism", "historic", "craft", "shop", "amenity", "cuisine", "website", "wikidata") if tags.get(key)},
        "evidence_type": "mapped_place_not_verified_buyer", "retrieved_at": utc_now()
    }


def collect_osm_seed_places(session: requests.Session, areas: list[dict[str, Any]], radius_m: int = 3500,
                            sleep_seconds: float = 1.8) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records: list[dict[str, Any]] = []
    failures: list[str] = []
    for i, area in enumerate(areas):
        lat, lon = area["lat"], area["lon"]
        query = (
            f'[out:json][timeout:25];('
            f'nwr(around:{radius_m},{lat},{lon})["tourism"~"{TOURISM_TAGS}"]["name"];'
            f'nwr(around:{radius_m},{lat},{lon})["historic"~"monument|memorial|ruins|castle|archaeological_site"]["name"];'
            f'nwr(around:{radius_m},{lat},{lon})["craft"]["name"];'
            f'nwr(around:{radius_m},{lat},{lon})["shop"~"gift|souvenir|art|craft"]["name"];'
            f');out center tags;'
        )
        try:
            payload = fetch_json(session, OSM_OVERPASS, {"data": query}, timeout=45)
            rows = payload.get("elements", []) if isinstance(payload, dict) else []
            records.extend(item for row in rows if isinstance(row, dict) and (item := normalize_osm_element(row, area)))
            logger.info("OpenStreetMap seed: %s returned %d records", area["id"], len(rows))
        except (requests.RequestException, ValueError, TypeError) as exc:
            failures.append(f"{area['id']}: {type(exc).__name__}")
            logger.warning("OpenStreetMap seed query failed for %s: %s", area["id"], type(exc).__name__)
        if i < len(areas) - 1:
            time.sleep(max(0, sleep_seconds))
    status = "ok" if records and not failures else "partial" if records else "failed"
    return records, {"status": status, "records": len(records), "failed_areas": failures,
                     "license": "ODbL 1.0; attribution required; share-alike obligations may apply"}


def flatten_country(row: dict[str, Any]) -> str:
    return flatten_names(row.get("countries") or row.get("country") or row.get("countries_en") or row.get("state_party") or row.get("states_parties") or row.get("country_en"))


def normalize_ich_record(row: dict[str, Any]) -> dict[str, Any] | None:
    name = first_text(row, (
        "name_en", "element_en", "element_name_en", "name", "element_name",
        "name_of_element", "element", "title"
    ))
    if not name:
        # Some catalogues provide a language-keyed field instead of a single name.
        for key, value in row.items():
            if re.search(r"(name|element|title)", key, re.I) and isinstance(value, str) and value.strip():
                name = value.strip()
                break
    if not name:
        return None
    country = flatten_country(row)
    year_val = None
    for key in ("inscription_year", "year", "year_inscribed", "inscription_year_en"):
        try:
            if row.get(key) not in (None, ""):
                year_val = int(str(row[key])[:4])
                break
        except (TypeError, ValueError):
            continue
    description = first_text(row, ("description_en", "short_description_en", "description", "short_description"))
    url = first_text(row, ("url", "url_en", "element_url", "record_url"))
    return {
        "id": first_text(row, ("id", "element_id", "code")) or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
        "name": name, "country_or_countries": country, "inscription_year": year_val,
        "description": description, "url": url or "https://ich.unesco.org/en/lists",
        "source": "UNESCO Intangible Cultural Heritage List", "source_dataset": "ich001",
        "source_url": "https://data.unesco.org/explore/dataset/ich001/api/",
        "license": "CC BY-SA 4.0", "evidence_type": "cultural_context_not_nearby_business",
    }


def collect_unesco_ich(session: requests.Session, page_size: int = 100, max_pages: int = 30) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records: list[dict[str, Any]] = []
    offsets = 0
    pages = 0
    while pages < max_pages:
        payload = fetch_json(session, UNESCO_API, {"limit": min(100, page_size), "offset": offsets}, timeout=45)
        if not isinstance(payload, dict):
            raise RuntimeError("Unexpected UNESCO DataHub payload")
        rows = payload.get("results", [])
        if not isinstance(rows, list):
            raise RuntimeError("UNESCO DataHub response does not contain results")
        records.extend(item for row in rows if isinstance(row, dict) and (item := normalize_ich_record(row)))
        pages += 1
        offsets += len(rows)
        total = payload.get("total_count")
        if not rows or len(rows) < min(100, page_size) or (isinstance(total, int) and offsets >= total):
            break
    if not records:
        raise RuntimeError("UNESCO DataHub returned no normalisable heritage records")
    return records, {"status": "ok", "records": len(records), "pages": pages, "license": "CC BY-SA 4.0",
                     "dataset_url": "https://data.unesco.org/explore/dataset/ich001/api/"}


def normalize_designated_site(row: dict[str, Any], dataset: dict[str, str]) -> dict[str, Any] | None:
    """Normalize georeferenced UNESCO-designated areas/sites for the map picker."""
    if not isinstance(row, dict):
        return None
    fields = row.get("fields") if isinstance(row.get("fields"), dict) else row
    name = first_text(fields, (
        "name_en", "title_en", "site_name_en", "site_name", "name", "title",
        "name_of_site", "property_name", "designation_name"
    ))
    if not name:
        for key, value in fields.items():
            if re.search(r"(name|title|site)", key, re.I) and isinstance(value, str) and value.strip():
                name = value.strip()
                break
    if not name:
        return None

    coordinates: Any = None
    for key in ("coordinates", "geo_point_2d", "geo_point", "location"):
        if fields.get(key) not in (None, ""):
            coordinates = fields[key]
            break
    lat = lon = None
    if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
        # UNESCO DataHub geo-point fields are serialized as [latitude, longitude].
        lat, lon = as_float(coordinates[0]), as_float(coordinates[1])
    elif isinstance(coordinates, dict):
        lat = as_float(coordinates.get("lat") or coordinates.get("latitude"))
        lon = as_float(coordinates.get("lon") or coordinates.get("lng") or coordinates.get("longitude"))
    elif isinstance(coordinates, str):
        try:
            decoded = json.loads(coordinates)
        except (json.JSONDecodeError, TypeError):
            decoded = None
        if isinstance(decoded, (list, tuple)) and len(decoded) >= 2:
            lat, lon = as_float(decoded[0]), as_float(decoded[1])
        else:
            numbers = re.findall(r"-?\d+(?:\.\d+)?", coordinates)
            if len(numbers) >= 2:
                lat, lon = as_float(numbers[0]), as_float(numbers[1])
    if lat is None or lon is None:
        lat = as_float(fields.get("latitude") if fields.get("latitude") is not None else fields.get("lat"))
        lon = as_float(fields.get("longitude") if fields.get("longitude") is not None else fields.get("lon"))
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None

    country_value = None
    for key in (
        "states_names_en", "states_name_en", "states_names", "state_party", "states_parties",
        "country_title_en", "countries_en", "country_en", "countries", "country", "country_name",
        "country_name_en", "iso2"
    ):
        value = fields.get(key)
        if value not in (None, "", [], {}):
            country_value = value
            break
    country = flatten_names(country_value) or "Country not specified"
    external_id = first_text(fields, ("id_no", "mab_id", "uuid", "id", "code")) or re.sub(
        r"[^a-z0-9]+", "-", (dataset["dataset"] + "-" + name).lower()
    ).strip("-")
    site_url = first_text(fields, ("url", "website", "site_url"))
    if not site_url and dataset["dataset"] == "whc001":
        site_url = "https://whc.unesco.org/en/list/" + external_id + "/"
    return {
        "id": dataset["dataset"] + ":" + external_id,
        "external_id": external_id,
        "source": "UNESCO DataHub",
        "source_dataset": dataset["dataset"],
        "category": dataset["category"],
        "designation": dataset["designation"],
        "name": name,
        "country": country,
        "country_code": first_text(fields, ("iso2", "iso3", "country_iso2", "country_iso3")),
        "lat": lat,
        "lon": lon,
        "inscription_year": first_text(fields, ("date_inscribed", "year_inscribed", "inscription_year", "date")),
        "url": site_url or dataset["dataset_url"],
        "source_url": dataset["dataset_url"],
        "license": dataset["license"],
        "evidence_type": "official_unesco_designation_reference",
        "retrieved_at": utc_now(),
    }


def collect_unesco_designated_sites(
    session: requests.Session, page_size: int = 100, max_pages: int = 30
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fetch World Heritage, Global Geopark and Biosphere Reserve reference records."""
    items: list[dict[str, Any]] = []
    dataset_status: dict[str, Any] = {}
    page_size = max(1, min(100, page_size))
    for dataset in UNESCO_DESIGNATED_DATASETS:
        dataset_items: list[dict[str, Any]] = []
        offset = 0
        pages = 0
        try:
            while pages < max_pages:
                payload = fetch_json(
                    session,
                    UNESCO_DESIGNATED_API.format(dataset=dataset["dataset"]),
                    {"limit": page_size, "offset": offset},
                    timeout=45,
                )
                if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
                    raise RuntimeError("Unexpected UNESCO DataHub response")
                rows = payload["results"]
                for row in rows:
                    if isinstance(row, dict):
                        normalized = normalize_designated_site(row, dataset)
                        if normalized:
                            dataset_items.append(normalized)
                pages += 1
                offset += len(rows)
                total = payload.get("total_count")
                if not rows or len(rows) < page_size or (isinstance(total, int) and offset >= total):
                    break
                time.sleep(0.15)
            if dataset_items:
                dataset_status[dataset["dataset"]] = {
                    "status": "ok", "records": len(dataset_items), "pages": pages,
                    "dataset_url": dataset["dataset_url"], "license": dataset["license"],
                }
                items.extend(dataset_items)
                logger.info("UNESCO %s: %d coordinate records", dataset["dataset"], len(dataset_items))
            else:
                dataset_status[dataset["dataset"]] = {
                    "status": "empty", "records": 0, "pages": pages,
                    "dataset_url": dataset["dataset_url"], "license": dataset["license"],
                }
                logger.warning("UNESCO %s returned no usable coordinate records", dataset["dataset"])
        except (requests.RequestException, RuntimeError, ValueError, TypeError, KeyError) as exc:
            dataset_status[dataset["dataset"]] = {
                "status": "failed", "records": len(dataset_items), "pages": pages,
                "error_type": type(exc).__name__, "dataset_url": dataset["dataset_url"],
            }
            logger.warning("UNESCO %s request failed: %s", dataset["dataset"], type(exc).__name__)

    successes = sum(v["status"] == "ok" for v in dataset_status.values())
    failures = sum(v["status"] == "failed" for v in dataset_status.values())
    overall = "ok" if successes == len(UNESCO_DESIGNATED_DATASETS) else "partial" if successes else "failed"
    return items, {
        "status": overall, "records": len(items), "datasets": dataset_status,
        "license": "CC BY-SA 4.0", "attribution": "UNESCO DataHub",
        "note": "Designated-site coordinates are searchable reference points; large reserves and multi-site properties may cover a wider area."
    }


def normalize_food_product(row: dict[str, Any], query_term: str) -> dict[str, Any] | None:
    code = first_text(row, ("code", "id"))
    name = first_text(row, ("product_name", "product_name_en", "generic_name"))
    if not code or not name:
        return None
    return {
        "id": "openfoodfacts:" + code, "barcode": code, "name": name,
        "brands": first_text(row, ("brands",)), "quantity": first_text(row, ("quantity",)),
        "categories": flatten_names(row.get("categories_tags_en") or row.get("categories_tags") or row.get("categories")),
        "ingredients": first_text(row, ("ingredients_text_en", "ingredients_text")),
        "countries": flatten_names(row.get("countries_tags") or row.get("countries")),
        "packaging": flatten_names(row.get("packaging_tags") or row.get("packaging")),
        "nutrition_grade": first_text(row, ("nutriscore_grade",)),
        "url": "https://world.openfoodfacts.org/product/" + code,
        "source": "Open Food Facts", "source_url": "https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/",
        "license": "Open Food Facts database ODbL 1.0; product images may have separate licences",
        "query_term": query_term, "evidence_type": "packaged_product_catalogue_not_sales",
        "retrieved_at": utc_now()
    }


def collect_openfoodfacts(session: requests.Session, terms: list[str], page_size: int = 20,
                          sleep_seconds: float = 6.2) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    products: dict[str, dict[str, Any]] = {}
    failures: list[str] = []
    # The provider documents a 10 requests/minute limit for search. Keep requests sequential and paced.
    for i, term in enumerate(terms):
        try:
            payload = fetch_json(session, OPENFOODFACTS_SEARCH, {
                "search_terms": term, "search_simple": 1, "action": "process", "json": 1,
                "page_size": max(1, min(50, page_size)),
                "fields": "code,product_name,product_name_en,brands,quantity,categories_tags_en,categories_tags,ingredients_text_en,ingredients_text,countries_tags,packaging_tags,nutriscore_grade"
            }, timeout=45)
            rows = payload.get("products", []) if isinstance(payload, dict) else []
            for row in rows if isinstance(rows, list) else []:
                if not isinstance(row, dict):
                    continue
                product = normalize_food_product(row, term)
                if product:
                    existing = products.get(product["barcode"])
                    if existing:
                        existing["matched_queries"] = sorted(set(existing.get("matched_queries", []) + [term]))
                    else:
                        product["matched_queries"] = [term]
                        products[product["barcode"]] = product
            logger.info("Open Food Facts: query %s returned %d products", term, len(rows) if isinstance(rows, list) else 0)
        except (requests.RequestException, ValueError, TypeError) as exc:
            failures.append(f"{term}: {type(exc).__name__}")
            logger.warning("Open Food Facts request failed for query %s: %s", term, type(exc).__name__)
        if i < len(terms) - 1:
            time.sleep(max(0, sleep_seconds))
    items = list(products.values())
    status = "ok" if items and not failures else "partial" if items else "failed"
    return items, {"status": status, "records": len(items), "queries": terms, "failed_queries": failures,
                   "note": "Product catalogue only; not sales volume, price history or market share."}


def collect_worldbank_arrivals(session: requests.Session, areas: list[dict[str, Any]], years: int = 10,
                               sleep_seconds: float = 0.15) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_country: dict[str, dict[str, Any]] = {}
    countries = {str(area.get("iso2", "")).upper(): area.get("country", "") for area in areas if area.get("iso2")}
    failures: list[str] = []
    for i, (iso2, name) in enumerate(sorted(countries.items())):
        try:
            payload = fetch_json(session, f"{WORLD_BANK_API}/country/{iso2}/indicator/ST.INT.ARVL", {
                "format": "json", "per_page": max(1, min(25, years))
            }, timeout=35)
            rows = payload[1] if isinstance(payload, list) and len(payload) > 1 and isinstance(payload[1], list) else []
            series = [{"year": int(r["date"]), "international_tourist_arrivals": as_float(r.get("value"))}
                      for r in rows if isinstance(r, dict) and str(r.get("date", "")).isdigit()]
            by_country[iso2] = {
                "iso2": iso2, "country": name, "indicator_id": "ST.INT.ARVL",
                "indicator_name": "International tourism, number of arrivals",
                "unit": "arrivals (each entry can represent a trip/arrival, not unique people)",
                "series": series, "latest": next((item for item in series if item["international_tourist_arrivals"] is not None), None),
                "source": "World Bank Indicators API", "source_url": f"https://api.worldbank.org/v2/country/{iso2}/indicator/ST.INT.ARVL",
                "evidence_type": "annual_country_tourism_context_not_site_visits"
            }
        except (requests.RequestException, ValueError, TypeError) as exc:
            failures.append(f"{iso2}: {type(exc).__name__}")
            logger.warning("World Bank tourism indicator failed for %s: %s", iso2, type(exc).__name__)
        if i < len(countries) - 1:
            time.sleep(max(0, sleep_seconds))
    items = list(by_country.values())
    status = "ok" if items and not failures else "partial" if items else "failed"
    return items, {"status": status, "countries": len(items), "failed_countries": failures,
                   "indicator_id": "ST.INT.ARVL", "note": "Country-level annual context; not visitor counts for a particular attraction."}


def _merge_places(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for row in records:
        if not row.get("id"):
            continue
        merged.setdefault(str(row["id"]), row)
    return sorted(merged.values(), key=lambda row: (str(row.get("seed_area_id", "")), str(row.get("name", "")).casefold(), str(row.get("source", ""))))


def run() -> dict[str, dict[str, Any]]:
    logger.setLevel(os.getenv("LOG_LEVEL", "INFO"))
    areas, food_terms = load_config()
    session = session_with_retries()
    api_key = os.getenv("OPENTRIPMAP_API_KEY", "").strip()
    now = utc_now()
    source_status: dict[str, Any] = {}

    def run_source(name: str, fn: Callable[[], tuple[list[dict[str, Any]], dict[str, Any]]]) -> list[dict[str, Any]]:
        try:
            records, status = fn()
            source_status[name] = status
            return records
        except Exception as exc:  # Keep independent feeds running if one provider is unavailable.
            source_status[name] = {"status": "failed", "records": 0, "error_type": type(exc).__name__}
            logger.warning("%s collector failed: %s", name, type(exc).__name__)
            return []

    osm = run_source("OpenStreetMap", lambda: collect_osm_seed_places(session, areas,
                   radius_m=int(os.getenv("TOURISM_OSM_SEED_RADIUS_M", "3500")),
                   sleep_seconds=float(os.getenv("TOURISM_OSM_SLEEP_SECONDS", "1.8"))))
    opentripmap = run_source("OpenTripMap", lambda: collect_opentripmap(session, areas, api_key,
                   radius_m=int(os.getenv("OPENTRIPMAP_RADIUS_M", "15000")),
                   limit=int(os.getenv("OPENTRIPMAP_LIMIT", "60")),
                   sleep_seconds=float(os.getenv("OPENTRIPMAP_SLEEP_SECONDS", "0.25"))))
    guides = run_source("Wikivoyage", lambda: collect_wikivoyage(session, areas,
                   radius_m=int(os.getenv("WIKIVOYAGE_RADIUS_M", "10000")),
                   limit=int(os.getenv("WIKIVOYAGE_LIMIT", "15")),
                   sleep_seconds=float(os.getenv("WIKIVOYAGE_SLEEP_SECONDS", "0.8"))))
    heritage = run_source("UNESCO ICH", lambda: collect_unesco_ich(session,
                   page_size=int(os.getenv("UNESCO_ICH_PAGE_SIZE", "100")),
                   max_pages=int(os.getenv("UNESCO_ICH_MAX_PAGES", "30"))))
    designated_sites = run_source("UNESCO Designated Sites", lambda: collect_unesco_designated_sites(
                   session,
                   page_size=int(os.getenv("UNESCO_DESIGNATED_PAGE_SIZE", "100")),
                   max_pages=int(os.getenv("UNESCO_DESIGNATED_MAX_PAGES", "30"))))
    food = run_source("Open Food Facts", lambda: collect_openfoodfacts(session, food_terms,
                   page_size=int(os.getenv("OFF_PAGE_SIZE", "20")),
                   sleep_seconds=float(os.getenv("OFF_REQUEST_SLEEP_SECONDS", "6.2"))))
    arrivals = run_source("World Bank Tourism Indicators", lambda: collect_worldbank_arrivals(session, areas,
                   years=int(os.getenv("WORLD_BANK_TOURISM_YEARS", "10")),
                   sleep_seconds=float(os.getenv("WORLD_BANK_REQUEST_SLEEP_SECONDS", "0.15"))))

    places = _merge_places(osm + opentripmap + guides)
    source_status["UN Tourism Statistics Database"] = {
        "status": "access_required", "records": 0,
        "url": "https://www.untourism.int/tourism-statistics/tourism-statistics-database",
        "method": "Official database/publication access; no unauthenticated public API configured",
        "note": "The official page states that free database access for students/researchers requires a formal written request. Do not scrape the portal or label country statistics as site-level visitor counts."
    }
    places_path = DATA_DIR / "tourism_places.json"
    heritage_path = DATA_DIR / "ich_heritage.json"
    food_path = DATA_DIR / "food_products.json"
    stats_path = DATA_DIR / "tourism_stats.json"
    designated_path = DATA_DIR / "designated_sites.json"

    previous_places = read_existing(places_path) or {}
    previous_heritage = read_existing(heritage_path) or {}
    previous_food = read_existing(food_path) or {}
    previous_stats = read_existing(stats_path) or {}
    previous_designated = read_existing(designated_path) or {}

    if places or not previous_places:
        write_json(places_path, {
            "schema_version": "1.0.0", "generated_at": now,
            "meta": {
                "project": "Global Product Intelligence Radar",
                "scope": "Scheduled reference snapshot around configured seed areas only; not a complete global POI feed.",
                "tourism_nearby_primary_threshold_km": 3,
                "tourism_very_near_threshold_km": 1,
                "proximity_policy": {
                    "very_close_km": 1,
                    "nearby_km": 3,
                    "tourism_relevance_boost_max_km": 3,
                    "note": "A 10-15 km map radius is for exploration and must not be treated as nearby-tourism evidence."
                },
                "seed_areas": len(areas), "place_records": len(places), "source_status": source_status,
                "limitations": ["Mapped places are leads, not verified businesses, active attractions, stock or buyers.",
                                "The current device/location is not sent to this collector. Dynamic nearby detection uses a separate on-demand query.",
                                "OpenTripMap and OpenStreetMap datasets carry attribution/licensing obligations."]
            },
            "items": places
        })
    else:
        logger.warning("No place records returned; preserving previous tourism_places.json")
    heritage_records = heritage if heritage else previous_heritage.get("items", [])
    if heritage_records:
        write_json(heritage_path, {
            "schema_version": "1.0.0", "generated_at": now if heritage else previous_heritage.get("generated_at", now),
            "meta": {"source": "UNESCO DataHub", "dataset": "ich001", "source_status": source_status.get("UNESCO ICH", {}),
                     "license": "CC BY-SA 4.0", "attribution": "UNESCO DataHub – Intangible Heritage List",
                     "note": "Cultural element records provide country/cultural context; they do not identify an artisan or prove a nearby workshop."},
            "items": heritage_records
        })
    food_records = food if food else previous_food.get("items", [])
    if food_records:
        write_json(food_path, {
            "schema_version": "1.0.0", "generated_at": now if food else previous_food.get("generated_at", now),
            "meta": {"source": "Open Food Facts", "source_status": source_status.get("Open Food Facts", {}),
                     "license": "ODbL 1.0 for database; product images may have separate licences",
                     "note": "Packaged-food catalogue metadata only; not a sales, sell-through or market-share dataset."},
            "items": food_records
        })
    # If one UNESCO dataset is temporarily unavailable, retain its last good records.
    designated_status = source_status.get("UNESCO Designated Sites", {})
    previous_designated_items = previous_designated.get("items", [])
    fresh_dataset_status = designated_status.get("datasets", {}) if isinstance(designated_status, dict) else {}
    successful_dataset_ids = {key for key, value in fresh_dataset_status.items()
                              if isinstance(value, dict) and value.get("status") == "ok"}
    retained_designated = [
        item for item in previous_designated_items
        if isinstance(item, dict) and item.get("source_dataset") not in successful_dataset_ids
    ]
    designated_by_id = {}
    for item in retained_designated + designated_sites:
        if isinstance(item, dict) and item.get("id"):
            designated_by_id[str(item["id"])] = item
    designated_records = sorted(designated_by_id.values(), key=lambda row: (
        str(row.get("country", "")).casefold(), str(row.get("designation", "")).casefold(),
        str(row.get("name", "")).casefold()
    ))
    write_json(designated_path, {
        "schema_version": "1.0.0",
        "generated_at": now if designated_sites else previous_designated.get("generated_at", now),
        "meta": {
            "source": "UNESCO DataHub",
            "source_status": designated_status,
            "license": "CC BY-SA 4.0",
            "attribution": "UNESCO DataHub",
            "datasets": {item["dataset"]: item["dataset_url"] for item in UNESCO_DESIGNATED_DATASETS},
            "note": "Global searchable reference for World Heritage Sites, UNESCO Global Geoparks and Biosphere Reserves. Coordinates are representative map points, not full boundaries; transboundary sites may appear in more than one country."
        },
        "items": designated_records,
    })
    stats_records = arrivals if arrivals else previous_stats.get("countries", [])
    write_json(stats_path, {
        "schema_version": "1.0.0", "generated_at": now if arrivals else previous_stats.get("generated_at", now),
        "meta": {"source_status": source_status, "note": "Annual country-level tourism context; not attraction-level counts or a live visitor feed.",
                 "UN_Tourism_access": "Official Tourism Statistics Database is listed as access_required until official data access/export is available.",
                 "UN_Tourism_url": "https://www.untourism.int/tourism-statistics/tourism-statistics-database"},
        "countries": stats_records
    })
    logger.info("Tourism pipeline completed: %d place records, %d ICH records, %d designated sites, %d packaged products, %d country arrival series",
                len(places), len(heritage_records), len(designated_records), len(food_records), len(stats_records))
    return source_status


def main() -> int:
    statuses = run()
    core_sources = ("Wikivoyage", "UNESCO ICH", "Open Food Facts", "World Bank Tourism Indicators")
    available = sum(statuses.get(name, {}).get("status") in ("ok", "partial") for name in core_sources)
    if available == 0:
        raise RuntimeError("All non-key tourism data sources failed; prior snapshots are preserved where possible")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    try:
        raise SystemExit(main())
    except Exception as exc:
        logging.exception("GPIR tourism refresh failed: %s", exc)
        raise SystemExit(1)
