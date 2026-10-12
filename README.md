# Global Product Intelligence Radar (GPIR)

An open-data starter for discovering product-market opportunities using international merchandise trade and macroeconomic indicators.

## What it does
- Static dashboard with market/product filters, KPI cards, opportunity rankings and a map.
- Python pipeline for UN Comtrade annual trade data and World Bank indicators.
- Weekly/manual GitHub Actions refresh.
- Transparent source and sample-data status; demo records are never labelled as live data.
- JSON output designed for downstream Horizon Scanning integration.

## Data sources
- UN Comtrade: https://comtradeapi.un.org/
- World Bank Indicators API: https://api.worldbank.org/v2/

UN Comtrade is trade data (not retail sales). Rankings are signals for further research, not guarantees of profitability. Where trade quantity or marketplace sales are unavailable, the dashboard must not imply they were observed.

## Run locally
Requires Python 3.11+.

```bash
python -m pip install -r requirements.txt
python scripts/build_data.py
python -m unittest discover -s tests -v
```

Add the secret `COMTRADE_API_KEY` in repository Settings → Secrets and variables → Actions for scheduled runs. Without a key, public API access may be limited; the pipeline records errors rather than fabricating live data.

## Deploy
Enable GitHub Pages from branch `main`, folder `/ (root)`. The dashboard reads `data/data.json`.

## Configure
Workflow: Actions → Update trade data → Run workflow. The pipeline defaults to a small, configurable list of HS chapters and reporter markets to control API usage.

## Data integrity
- Keep HS classification version and reporting period attached to trade rows.
- Do not compare HS revisions without a concordance.
- Do not calculate CAGR from zero/negative values.
- Treat missing values as unknown, not zero.
- Keep API credentials out of browser code and committed files.

## License
MIT (see LICENSE). Check each upstream dataset's terms before redistributing derived data.
