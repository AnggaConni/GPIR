# Global Product Intelligence Radar (GPIR)

An open-data starter to screen product–market opportunities using UN Comtrade trade statistics and World Bank country context. The homepage starts with local opportunity discovery; the global trade dashboard remains available below.

## Features
- Location-first homepage with permission-based geolocation, manual location search, nearby mapped places, and starter recommendations for selling, cultivation and services.
- Shared language selector for Indonesian, English, and the six official UN languages; users may choose manually or use browser-language detection.
- Responsive global dashboard, interactive map, product search, country filters and opportunity rankings.
- Python pipeline for quota-limited UN Comtrade trade data; browser-side World Bank API enrichment for country context.
- Six-digit HS product observations with yearly growth, CAGR and explainable percentile scoring.
- Weekly scheduled and manual GitHub Actions refresh.
- Tests for product code filtering and scoring safeguards.

## Data sources
- [UN Comtrade API](https://comtradeapi.un.org/) — reported merchandise trade, not retail sales.
- [World Bank Indicators API v2](https://api.worldbank.org/v2/) — geographic and macroeconomic context, fetched asynchronously in the frontend.

## Setup and deploy
1. In GitHub, open **Settings → Pages → Deploy from a branch**, choose `main` and `/ (root)`.
2. Add a repository secret named `UN_COMTRADE_API_KEY` under **Settings → Secrets and variables → Actions**. The workflow maps it to `COMTRADE_API_KEY` for Python; `COMTRADE_API_KEY` is also supported as a fallback secret name.
3. Run **Actions → Update trade data → Run workflow**.
4. Open the Pages URL published in Settings → Pages.

The public preview endpoint may be rate-limited or truncated. A run without a key is explicitly labelled `preview`; do not treat it as complete global coverage.

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
- `COMTRADE_MAX_RECORDS` — per-call maximum records.
- `market-context.js` — fetches public World Bank country/indicator context directly from the browser and caches it for 12 hours.
- `local-home.js` — location-first opportunity preview. Location and radius pass into `enterprise.html` so visitors do not have to enter them again.
- `i18n.js` — browser-side interface localisation for Indonesian, English, Spanish, French, Arabic, Chinese and Russian. It detects browser language, offers a manual selector, and stores the preference locally.
- `MARKET_ISO3` — comma-separated market override.
- `REQUEST_SLEEP_SECONDS` — pause between calls.

## Interpretation
- Import values are trade statistics, not marketplace sales, consumer spending, or profit.
- Commodity/HS source descriptions and raw provider observations are preserved when no curated translation is available. Language defaults follow browser preferences, not inferred location or identity.
- There is no completed-sales/retail feed connected yet. The current annual trade feed cannot produce a rolling 30-day sales trend. See the opportunity finder documentation for a safe 30-day data model and access requirements.
- The first market set is a subset, not a complete census of global trade.
- HS classification revisions, missing years, reporter updates and price effects can affect trend comparisons.
- Missing data is unknown, not zero.
- Scores are exploratory, relative to the retrieved dataset, and should only guide further research.
- Respect upstream dataset terms and attribution requirements.

## Local Enterprise Opportunity Finder

Open `enterprise.html` from the GitHub Pages site to explore microenterprise ideas matched to user-entered local resources, skills, startup budget, and target market.

- `data/opportunity_catalog.json` contains curated hypotheses with illustrative capital bands, suggested low-cost validation tests, and risks.
- The page matches these ideas against `data/data.json` trade signals when product descriptions align.
- Users can record available local resources in browser-local storage and export/import a JSON copy.
- Nearby mapped businesses can be searched on demand through OpenStreetMap/Overpass using coordinates or browser geolocation.
- Inputs and inventory are not sent to a server or shared by this static prototype.

**Evidence warning:** the UI fit score measures relevance to submitted inputs only. UN Comtrade values are reported imports, not local marketplace sell-through. Overpass locations do not prove the business is open or that it has stock. Catalogue ideas are hypotheses, not sales predictions. See [Local Enterprise Opportunity Finder documentation](docs/LOCAL_ENTERPRISE_OPPORTUNITY_FINDER.md) for source limitations, costs, validation gates, and roadmap.

## Integration
The output schema in `data/data.json` includes `meta`, `countries`, and `items`; the World Bank context is loaded separately in the browser and is not baked into the scheduled trade snapshot. see `docs/HORIZON_SCANNING_INTEGRATION.md` for a pattern to consume the JSON feed.

## License
Project code: MIT (see `LICENSE`). Upstream datasets remain subject to their own terms.


### UX and SME scope updates
- Profile separates available capital, business scale (micro/small/medium/scale-up), target market, and buyer segment (households, MSMEs, business/institutional buyers, and importers/distributors).
- Submitting resources and skills clears any old category filter and matches across sell/grow/service ideas.
- Whole-city map mode uses an explicitly searched city's/administrative area's bounding box; nearby mode remains a faster radius scan.

### Opportunity pathway and source types
The pathway combines visitor resources/skills with a curated idea catalogue, mapped nearby places and external-market context. A high match score means input fit—not a forecast or guarantee. The data connector register distinguishes active connections from candidates such as Open Food Facts product metadata, Google Trends search interest (alpha access), eBay active listings and approval-gated eBay sold-item history. Annual UN Comtrade flows, active listings, search interest and completed sales are different evidence types and should not be presented as interchangeable.


### Tourism-linked local economy
A scheduled Python collector builds tourism/place, travel-guide, UNESCO intangible-heritage, packaged-food catalogue, and country-level tourism-context snapshots in \`data/tourism_places.json\`, \`data/ich_heritage.json\`, \`data/food_products.json\`, and \`data/tourism_stats.json\`. Add the optional Actions secret \`OPENTRIPMAP_API_KEY\` for OpenTripMap. Tourist proximity is a separate local signal: within 1 km = very close; within 3 km = nearby; beyond 3 km is not used as the local tourism boost. World Bank arrivals are annual country statistics, not attraction footfall; UN Tourism direct database access is marked access-required unless official access/export is available.


### Initial tourism snapshot
The initial tourism/heritage/food snapshots are bootstrapped by a one-time GitHub Actions push whose commit message contains `bootstrap-tourism-snapshot`. Later automatic refreshes are handled by the weekly schedule or manual `workflow_dispatch`; the one-time bootstrap does not loop on the data commit. Set the optional Actions secret `OPENTRIPMAP_API_KEY` to enable OpenTripMap. Other collector endpoints can still be rate-limited or unavailable, and empty/failed feeds are reported rather than presented as verified demand.
