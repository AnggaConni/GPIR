# Global Product Intelligence Radar (GPIR)

An open-data starter to screen product–market opportunities using UN Comtrade trade statistics and World Bank country context. Dashboard outputs can feed other Horizon Scanning pages.

## What it includes
- Responsive static dashboard with search, market/product filters, map, ranking, and evidence panel.
- Python pipeline that maps official UN Comtrade reporter codes to ISO-3 markets.
- Six-digit HS product rows, growth/CAGR metrics, and explainable percentile scoring.
- Scheduled/manual GitHub Actions workflow to refresh the JSON dataset.
- Tests for data-quality rules.

## Data sources
- [UN Comtrade API](https://comtradeapi.un.org/) — reported merchandise trade, not retail sales.
- [World Bank Indicators API v2](https://api.worldbank.org/v2/) — population, coordinates, GDP per capita as context signals.

## Setup
1. Enable GitHub Pages in **Settings → Pages → Deploy from a branch → main / (root)**.
2. Add repository secret `COMTRADE_API_KEY` in **Settings → Secrets and variables → Actions**. Without a key, UN Comtrade public-preview access may be rate-limited or limited to a small sample.
3. Run **Actions → Update trade data → Run workflow**.

## Local use
Python 3.10+:

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m http.server 8080
```

Open `http://localhost:8080`.

## Environment variables
- `COMTRADE_API_KEY` — optional, recommended for more comprehensive requests.
- `COMTRADE_START_YEAR` and `COMTRADE_END_YEAR` — range of annual observations.
- `COMTRADE_MAX_RECORDS` — max records per API call.
- `MARKET_ISO3` — comma-separated ISO-3 markets overriding `config/markets.json`.
- `REQUEST_SLEEP_SECONDS` — delay between calls.

## Important interpretation caveats
- This starter begins in explicitly marked demo mode. It is replaced only after successful API fetch.
- Current market list is a configurable subset, not all countries.
- Import values do not prove retail sales, unmet demand, profit, or product viability.
- Latest observations vary by country; HS classification changes can affect time-series comparability.
- Missing data means unknown and should not be treated as zero.
- Review upstream data terms before republishing.

## License
Project code is licensed under MIT (see `LICENSE`). Upstream datasets remain subject to their source terms.
