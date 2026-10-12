# Global Product Intelligence Radar (GPIR)

An open-data starter to screen product–market opportunities using UN Comtrade trade statistics and World Bank country context. The static dashboard can feed other Horizon Scanning pages.

## Features
- Responsive dashboard, interactive country map, product search, country filters and opportunity rankings.
- Python pipeline using UN Comtrade and World Bank APIs.
- Six-digit HS product observations with yearly growth, CAGR and explainable percentile scoring.
- Weekly scheduled and manual GitHub Actions refresh.
- Tests for product code filtering and scoring safeguards.

## Data sources
- [UN Comtrade API](https://comtradeapi.un.org/) — reported merchandise trade, not retail sales.
- [World Bank Indicators API v2](https://api.worldbank.org/v2/) — geographic and macroeconomic context.

## Setup and deploy
1. In GitHub, open **Settings → Pages → Deploy from a branch**, choose `main` and `/ (root)`.
2. For more comprehensive refreshes, add a repository secret named `COMTRADE_API_KEY` under **Settings → Secrets and variables → Actions**.
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
- `COMTRADE_API_KEY` — recommended API key.
- `COMTRADE_START_YEAR` / `COMTRADE_END_YEAR` — requested annual range.
- `COMTRADE_MAX_RECORDS` — per-call maximum records.
- `MARKET_ISO3` — comma-separated market override.
- `REQUEST_SLEEP_SECONDS` — pause between calls.

## Interpretation
- Import values are trade statistics, not marketplace sales, consumer spending, or profit.
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
The output schema in `data/data.json` includes `meta`, `countries`, and `items`; see `docs/HORIZON_SCANNING_INTEGRATION.md` for a pattern to consume the JSON feed.

## License
Project code: MIT (see `LICENSE`). Upstream datasets remain subject to their own terms.
