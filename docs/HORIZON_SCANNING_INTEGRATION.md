# Horizon Scanning integration

GPIR publishes a static JSON feed at:

`data/data.json`

The top-level contract is:

- `schema_version`: schema version string.
- `generated_at`: UTC timestamp after a successful refresh.
- `meta`: run mode, selected years/markets, source notes, coverage, and limitations.
- `countries`: ISO-3 market records with available coordinates and macro context.
- `items`: HS-6 product-market signals, annual time series, growth metrics, score, and source metadata.

## Minimal consumer example

```js
async function loadGPIR() {
  const response = await fetch(
    "https://anggaconni.github.io/GPIR/data/data.json",
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error(`GPIR returned ${response.status}`);

  const feed = await response.json();
  if (!Array.isArray(feed.items) || !feed.meta) {
    throw new Error("Unsupported GPIR feed schema");
  }

  // Keep provenance and caveats attached when merging with other radar feeds.
  return feed.items.map((item) => ({
    id: `GPIR-${item.id}`,
    source: "GPIR",
    theme: "Product-market opportunity",
    title: item.product_name,
    market: item.market_name,
    country_iso3: item.market_iso3,
    location: {
      lat: item.market_latitude,
      lon: item.market_longitude
    },
    observed_year: item.latest_year,
    signal: item.yoy_growth_pct,
    score: item.opportunity_score,
    source_url: item.source_url,
    data_mode: item.data_mode,
    caveat: "Reported imports are not retail sales or proof of profitability."
  }));
}
```

## Integration principles

1. Keep the source label `GPIR` and record-level source attribution.
2. Use `market_latitude` and `market_longitude` only when both are valid numbers.
3. Distinguish `preview`, `live`, and `demo`/empty status. Never present preview data as complete global coverage.
4. Preserve observation year, HS code, source endpoint, and score coverage to support evidence review.
5. Do not combine unlike scores across radars without normalizing their definitions first.
6. A high opportunity score is exploratory. It does not establish sales, unmet demand, margins, or profitability.
