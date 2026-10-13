# Global Product Intelligence Radar (GPIR)

An open-data starter to screen product–market opportunities using UN Comtrade trade statistics and World Bank country context. The homepage starts with local opportunity discovery; the global trade dashboard remains available below.

## Features
- Location-first homepage with permission-based geolocation, manual location search, nearby mapped places, and starter recommendations for selling, cultivation and services.
- Integrated SME Finder ranking: user resources/skills and stage (start or grow), tourism proximity within 3 km, mapped buyer/supplier/retail leads within 5 km, and matching trade/import records all contribute to a transparent opportunity ranking.
- Shared language selector for Indonesian, English, and the six official UN languages; users may choose manually or use browser-language detection.
- Responsive global dashboard, interactive map, product search, country filters and opportunity rankings.
- **SVG trade-flow map mode:** curved supplier-to-buyer links from partner-level UN Comtrade import reports. Click a country to inspect the products it reports buying and the products other reporting markets declare as originating there.
- Python pipelines for quota-limited UN Comtrade trade data, selected bilateral import relationships, and scheduled tourism/heritage/context snapshots.
- UN Tourism bulk ZIP importer: downloads official Excel workbooks, safely extracts them, and exports every non-empty worksheet to JSON with source metadata and a manifest.
- Potential Explorer (`potential.html` + `potential.js`): world map occupying roughly three quarters of the desktop workspace with a compact filter/results sidebar. Users can click the map or drag a pin; the map draws glowing dashed links to mapped local businesses/attractions within 5 km and to international countries with matching UN Comtrade import observations.
- Six-digit HS product observations with yearly growth, CAGR and explainable percentile scoring.
- Weekly scheduled and manual GitHub Actions refresh.
- Tests for product code filtering, scoring safeguards, and UN Tourism Excel-to-JSON conversion.

## Data sources
- [UN Comtrade API](https://comtradeapi.un.org/) — reported merchandise trade, not retail sales.
- [World Bank Indicators API v2](https://api.worldbank.org/v2/) — geographic and macroeconomic context, fetched asynchronously in the frontend, plus annual country tourism indicators.
- [UN Tourism Statistics Database](https://www.untourism.int/tourism-statistics/tourism-statistics-database) — official bulk ZIP archive imported as worksheet-level JSON; a data snapshot, not a live API. Archived worksheet exports remain available for further data processing.
- [OpenStreetMap](https://www.openstreetmap.org/copyright), [OpenTripMap](https://dev.opentripmap.org/), [Wikivoyage](https://www.wikivoyage.org/), [UNESCO ICH](https://ich.unesco.org/), and [Open Food Facts](https://world.openfoodfacts.org/) — mapped places, travel-guide metadata, intangible heritage, and packaged-food catalogue context.

## Setup and deploy
1. In GitHub, open **Settings → Pages → Deploy from a branch**, choose `main` and `/ (root)`.
2. Add a repository secret named `UN_COMTRADE_API_KEY` under **Settings → Secrets and variables → Actions**. The workflow maps it to `COMTRADE_API_KEY` for Python; `COMTRADE_API_KEY` is also supported as a fallback secret name.
3. Optionally add the repository Actions secret `OPENTRIPMAP_API_KEY` to enable OpenTripMap places.
4. Run **Actions → GPIR CI and data refresh → Run workflow**, or wait for the weekly schedule.
5. Open the Pages URL published in Settings → Pages.

The public UN Comtrade preview endpoint may be rate-limited or truncated. A run without a key is explicitly labelled `preview`; do not treat it as complete global coverage.

## Local development
Requires Python 3.10+.

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m http.server 8080
```

Open `http://localhost:8080`.

## Configuration
Edit `config/markets.json` to set ISO-3 reporter markets. Optional environment variables:
- `COMTRADE_API_KEY` — environment variable read by Python; in GitHub Actions it is populated from the `UN_COMTRADE_API_KEY` repository secret (or the legacy `COMTRADE_API_KEY` secret).
- `COMTRADE_START_YEAR` / `COMTRADE_END_YEAR` — requested annual range.
- `COMTRADE_MAX_RECORDS` — per-call maximum records for the market product snapshot.
- `COMTRADE_FLOW_PRODUCTS_PER_MARKET` — number of leading product codes queried per reporting market for bilateral route visualization (default 8 with an API key; 2 in public preview mode).
- `COMTRADE_FLOW_MAX_RECORDS` — maximum records requested per bilateral flow call (default 50,000 when authenticated; preview remains capped at 500 by the source).
- `UN_TOURISM_BULK_URL` — optional URL override for the UN Tourism bulk archive; the default is the supplied May 2026 ZIP.
- `OPENTRIPMAP_API_KEY` — optional OpenTripMap source key.
- `market-context.js` — fetches public World Bank country/indicator context directly from the browser and caches it for 12 hours.
- `local-home.js` — location-first opportunity preview. Location and radius pass into `enterprise.html` so visitors do not have to enter them again.
- `i18n.js` — browser-side interface localisation for Indonesian, English, Spanish, French, Arabic, Chinese and Russian.
- `MARKET_ISO3` — comma-separated market override.
- `REQUEST_SLEEP_SECONDS` — pause between calls.

The default reporter-market set in `config/markets.json` includes the Netherlands (NLD) to support international Potential Explorer links. Run **Actions → GPIR CI and data refresh → Run workflow** after changing market coverage so `data/data.json` includes fresh observations for NLD. Without refreshed NLD rows, the map intentionally shows no Dutch link when the snapshot has no matching data.

## Bilateral trade-flow map

The map has two layers: **Market signals** (the existing product-market ranking) and **Trade flows** (an SVG-rendered network of selected bilateral import observations).

- `pipeline/fetch_trade_flows.py` reads the existing product-market snapshot, selects a limited number of high-value HS product codes for each configured reporting market, and requests partner-level imports from UN Comtrade using `partnerCode=ALL`.
- Each route is oriented from the reporting partner's declared origin (`supplier_iso3`) to the reporting importer/buyer (`buyer_iso3`). A country popup separates the products it reports importing from partners from products that other reporting markets declare as originating there.
- The route snapshot is written separately to `data/trade_flows.json`; this avoids inflating `data/data.json` or changing the existing scoring dataset. The scheduled/manual data workflow refreshes both files, and the bootstrap workflow populates the first route snapshot.
- With no API key, the public preview is limited to 500 records per request and the routes are clearly marked as incomplete. Authenticated runs also remain a selected-product snapshot, not a complete trade matrix.
- Country relationships are based on reported imports, not named businesses or verified orders. Import-reported values can differ from mirror exports. Line thickness represents the summed value of the selected product observations for that pair, not transport volume or sales.

## Interpretation
- Import values are trade statistics, not marketplace sales, consumer spending, or profit.
- Country-level tourism indicators and UN Tourism workbook statistics are not attraction-level footfall unless the source indicator explicitly measures attraction visits.
- UN Tourism worksheet JSON preserves the original grid layout. Multi-row headers, units, country codes, year columns, footnotes and missing-value codes should be reviewed before charting or cross-country comparisons.
- The bulk importer stores source URL, archive name, worksheet name, generated timestamp and row/column counts. See [UN Tourism bulk import documentation](docs/UN_TOURISM_BULK_IMPORT.md).
- Commodity/HS source descriptions and raw provider observations are preserved when no curated translation is available. Missing data is unknown, not zero.
- There is no completed-sales/retail feed connected yet. The current annual trade feed cannot produce a rolling 30-day sales trend. See the opportunity finder documentation for a safe 30-day data model and access requirements.
- The first market set is a subset, not a complete census of global trade. HS classification revisions, missing years, reporter updates and price effects can affect trend comparisons.
- Scores are exploratory, relative to the retrieved dataset, and should only guide further research.
- Respect upstream dataset terms and attribution requirements.

## Local Enterprise Opportunity Finder

Open `enterprise.html` from GitHub Pages for the primary **Local SME Opportunity Finder**. It combines user-entered local resources, skills, budget, target buyer, and business stage with tourism and market context.

- The ranking gives stronger tourism relevance to ideas such as local guides, food stalls, souvenirs and craft experiences when a mapped attraction is within 3 km. This is a proximity signal, not a visitor count.
- Without nearby tourism, ideas can still rank well through resource/skill fit, mapped local buyer/supplier leads, and matching UN Comtrade product-import signals.
- The catalogue includes a small local food-stall idea and a craft/souvenir consignment kiosk alongside cultivation, processing and service ideas.
- Start mode emphasizes low-cost tests; grow mode emphasizes repeat buyers, margin, quality consistency, capacity and cash flow.
- `data/opportunity_catalog.json` contains curated business hypotheses, illustrative capital bands, buyer hypotheses, validation tests and risks.
- Matching rows from `data/data.json` are trade/import statistics, not local retail sales, confirmed buyers, or sales forecasts.
- Users can record resources in browser-local storage and export/import JSON. Nearby mapped places are queried on demand through OpenStreetMap/Overpass.
- Inputs and inventory remain in the browser; this static prototype does not send the business profile to a GPIR server.

The separate `tourism.html` page remains available for deeper UN Tourism worksheet exploration. It loads one selected worksheet at a time rather than all bulk JSON files on page load.

**Evidence warning:** the UI fit score measures relevance to submitted inputs only. UN Comtrade values are reported imports, not local marketplace sell-through. Overpass locations do not prove the business is open or that it has stock. Catalogue ideas are hypotheses, not sales predictions. See [Local Enterprise Opportunity Finder documentation](docs/LOCAL_ENTERPRISE_OPPORTUNITY_FINDER.md) for source limitations, costs, validation gates, and roadmap.

## Integration
The output schema in `data/data.json` includes `meta`, `countries`, and `items`; the World Bank context is loaded separately in the browser and is not baked into the scheduled trade snapshot. See `docs/HORIZON_SCANNING_INTEGRATION.md` for a pattern to consume the JSON feed.

## License
Project code: MIT (see `LICENSE`). Upstream datasets remain subject to their own terms.

### Tourism-linked local economy
A scheduled Python collector builds tourism/place, travel-guide, UNESCO intangible-heritage, packaged-food catalogue, and country-level tourism-context snapshots in `data/tourism_places.json`, `data/ich_heritage.json`, `data/food_products.json`, and `data/tourism_stats.json`. Tourist proximity is a separate local signal: within 1 km = very close; within 3 km = nearby; beyond 3 km is not used as the local tourism boost. World Bank arrivals are annual country statistics, not attraction footfall; see source-specific caveats in the JSON metadata.

### Potential Explorer

Open `potential.html` for the **Potential Explorer** world map. The former `tourism.html` URL redirects here for compatibility. The user can click anywhere on the map to place the red origin pin, drag it to a new point, or search for a named location. It fetches relevant OpenStreetMap points on demand, draws dashed/glowing connections to mapped tourist attractions within 5 km and nearby local ecosystem points, and can draw international connections where the GPIR trade snapshot has matching product-import observations. Destination links are grouped by country and can be zoomed individually.

Product terms such as `singkong` expand to English trade terms such as cassava/manioc/tapioca for matching. The UI shows a market link only when a relevant observation is present; no data match is not evidence that demand is absent. Trade rows are reported national imports, not retail sales or confirmed buyer orders. The configured reporter set includes the Netherlands (NLD), but refresh Actions to populate new observations.

### UN Tourism bulk statistics

`pipeline/import_un_tourism_bulk.py` downloads the official ZIP, safely extracts Excel workbooks and exports each non-empty worksheet to `data/un_tourism/sheets/*.json`. `data/un_tourism/manifest.json` inventories the outputs. The ZIP archive itself is not committed, only the JSON exports. These archived statistics remain available for further data processing. See `docs/UN_TOURISM_BULK_IMPORT.md`.
