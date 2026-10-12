# Local Enterprise Opportunity Finder (LEOF)

LEOF is a GPIR sub-feature for people exploring micro-enterprises from resources available in their district or small town. It combines user-entered local resources, a curated catalogue of business hypotheses, open-data market signals, and optional mapped points of interest.

## User goal

> Given local resources, skills, a very small starting budget, and the intended market (local and/or international), which business ideas should I validate first?

The feature is a decision-support aid. It does not promise that a product will sell or be profitable.

## Current implementation

- `index.html` + `local-home.js`: homepage quick-start panel with geolocation permission, manual location search, nearby map, one recommended idea per business category, supplier/buyer search links and relationship flow.
- `i18n.js`: shared language selector on home and detail pages. Includes Indonesian, English and all six official UN languages; defaults to browser preferences, supports manual switching, and stores the choice in local storage.
- `enterprise.html`: detailed responsive Finder. The homepage passes coordinates, location label, radius and business type as query parameters.
- `enterprise.js`: integrated rule-based ranking across user fit, nearby tourist attractions, mapped local buyer/supplier/retail leads, and matched UN Comtrade import signals; start-vs-grow action plans; location search, permission-based first-load geolocation, nearby OSM/Overpass lookup with browser cache, relationship-flow visual, marketplace search links and local inventory management.
- `data/opportunity_catalog.json`: curated hypotheses, product ideas, resource/skill keywords, illustrative starting-capital bands, first validation test, and risk prompts.
- `data/data.json`: scheduled UN Comtrade feed. Current schema contains `meta`, `countries`, and `items`; public macro data are deliberately not duplicated into this file.
- `market-context.js`: async browser-side World Bank enrichment, with graceful fallback if the API or network is unavailable.
- `index.html`: navigation to the new Local Enterprise Opportunity Finder.

## Architecture

1. **Quota-limited trade layer:** `pipeline/fetch_data.py` fetches UN Comtrade annual imports to `data/data.json`. This scheduled Python collector is reserved for the source that benefits from controlled, keyed, cached requests. It represents reported cross-border trade—not retail sell-through.
2. **Open country context:** `market-context.js` requests the no-key World Bank Indicators API directly from the browser (country coordinates, GDP per capita and population). It runs asynchronously, has a 12-hour browser-session cache, and does not make the trade collector wait on macro data. It is context, not product demand evidence.
2. **Opportunity hypotheses:** `data/opportunity_catalog.json` stores hand-curated business ideas with the resources they typically require, a low-capital starting path, a buyer-validation task and risks.
3. **Local context layer:** on first open, the browser requests geolocation permission. If allowed, the page queries mapped places nearby and caches results in the browser session. If denied, users can search for a district/city/address and choose a search radius. Location queries are sent to OpenStreetMap services, not the GPIR server. The public [Nominatim service policy](https://operations.osmfoundation.org/policies/nominatim/) requires explicit search rather than autocomplete, caching and usage limits. Attribution: [OpenStreetMap copyright/licence](https://www.openstreetmap.org/copyright).
4. **Community resource inventory:** resource, quantity, unit, availability and indicative price can be entered by the user. The starter stores it in that browser's localStorage and can export/import JSON. It is not sent to the repository or shared with other users.
5. **Matching and evidence layer:** an input-fit score ranks ideas against self-reported resources, skills, capital and target market. Nearby mapped places are a separate lead/channel hint; annual trade rows are a separate country-level import signal. Neither proves sales or buyer intent. The relationship flow connects local input → product/service → candidate buyers → mapped local leads → candidate trade-market research.
6. **Future shared service (optional):** if communities need cross-device/shared supplier data, add a backend such as Supabase with authentication, role-based row-level security, explicit consent, audit trail, and a moderation workflow. Do not put community-written records into a public repository by default.

## Integrated SME ranking semantics

The Finder now ranks opportunities from several evidence layers rather than treating tourism proximity as a separate recommendation product:

- **User fit:** matching resource keywords (up to 36 points), matching skills (up to 18), target-market fit (up to 8), buyer-segment fit (up to 12), capital tier (up to 5), and desired scale (up to 5).
- **Business stage:** starting a business modestly favours lower illustrative entry costs; developing an existing SME favours ideas with clearer repeat-buyer/channel paths (up to 5 points). The action plan also changes: start mode focuses on small experiments, while grow mode focuses on repeat purchase, consistency, margin, capacity and cash flow.
- **Tourism proximity:** a mapped tourism point within 1 km or 1–3 km can raise ideas with a matching tourism-fit hypothesis (up to 16 points). No tourism boost is applied when no mapped attraction is within 3 km.
- **Local business ecosystem:** relevant mapped non-tourism points such as markets, retail, food buyers, suppliers and makers within 5 km contribute up to 10 points.
- **Trade signal:** matching product/import rows in the GPIR trade feed contribute up to 12 points. The UI labels this as a trade/import signal, not local sales.

The combined score is normalized to 0–100 for ranking and should be read as relevance to the selected profile and available contextual signals—not a probability of success, demand forecast, sales estimate or expected revenue. If no tourism point is nearby, ideas can still rank highly when local resources/skills, mapped channels or trade signals fit.

Mapped POIs are leads and can be incomplete or stale; they are not confirmed buyers, open shops, available stock or visitor counts. Tourism fit labels in the catalogue are planning hypotheses. UN Comtrade reports cross-border trade, not retail sell-through or proof of demand in a particular town. World Bank/UN Tourism country indicators are context, not site-level footfall.

The opportunity catalogue includes approximate microenterprise startup-cost bands in IDR. These are planning placeholders, not official averages or supplier quotes. Calibrate them using local quotes, actual equipment needs, food-safety requirements, packaging, distribution, permits, rent and working capital.

## Data source register

| Source | Data available | Evidence class | Access / limitations |
|---|---|---|---|
| [UN Comtrade API](https://comtradeapi.un.org/) | Reported import/export value and quantity where available, product HS and partner country | **Observed trade statistic** | Free access has quotas/preview limitations; key improves access. Not consumer sales or stock shortage. |
| [SIPEDAS Kementan API](https://sipedas.pertanian.go.id/api/default/index) | Selected horticultural statistics by time and region, depending on module | **Reported production statistic** | API documentation exposes a `key` parameter. Check access, permitted use and coverage; don't expose credentials in browser code. Production volume isn't inventory currently available for sale. |
| [BPS WebAPI](https://webapi.bps.go.id/developer) | Population and other official statistics by geography, where published | **Official statistical indicator** | Developer registration/key may be required. Indicators are context, not product demand. |
| [OpenStreetMap / Overpass](https://overpass-turbo.eu/) | Mapped shops, markets, crafts and some facilities with coordinates | **Mapped presence** | Community completeness varies; not inventory, turnover or proof a business is open. Public instances are rate-limited/fair-use; current UI calls only on explicit user action. |
| [World Bank Indicators API](https://api.worldbank.org/v2/) | Population, GDP/capita and macroeconomic indicators | **Official country-level context** | Called directly in the frontend because no API key is required. Browser-side cache is 12 hours; values can be national-level and lagged. This is not a sales signal. |
| [FAOSTAT](https://www.fao.org/faostat/) | Agriculture, food and commodity production/trade statistics | **Reported / compiled statistics** | Open datasets, but geography, units, years and refresh cadence vary by dataset. |
| [Open Food Facts API](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md) | Community-contributed food product catalogue, ingredients and pack metadata | **Product catalogue** | Not sales data; API has rate limits. Bulk exports are preferable for large-scale analysis. |
| [eBay Browse API](https://developer.ebay.com/develop/api/buy/browse_api) | Listings, asking prices and availability | **Current listing / asking-price proxy** | App/OAuth access; marketplace and API quotas apply. Does not prove sold quantity. |
| [eBay Marketplace Insights](https://www.edp.ebay.com/api-docs/buy/marketplace-insights/static/overview.html) | Search for sold-item history up to 90 days | **Sold-item data when approved** | Limited release for select approved developers; never assume access is granted. |
| [Google Trends](https://trends.google.com/trends/) | Search-interest indices by time/region where available | **Interest proxy** | Search interest is not purchase data; official API access has been limited/alpha. |

### Data-evidence labels

- **Observed transaction / sales:** only when a source explicitly measures completed transactions for the relevant scope and time period, or the user provides verified till/order records.
- **Reported trade:** Comtrade import/export records, by HS code and reporter/partner/year.
- **Reported production:** government or statistical source for a crop/sector and period.
- **Listing / asking price:** live marketplace offer. Not sale.
- **Search interest:** relative search index. Not sale.
- **Mapped location:** a facility recorded in OSM. Not proof of activity, inventory or demand.
- **User-entered resource:** a statement from the user/community; should be labelled as self-reported until verified.
- **Opportunity hypothesis:** an idea from the curated catalogue to test, not an evidenced market outcome.

Every future server-side connector should retain `source`, `retrieved_at`, `observed_period`, `geography`, `unit`, `evidence_type`, `coverage` and a source URL where practical.

## Validation method before recommending investment

### Gate 1 — Verify local supply
- Ask the user/community to record resource, quantity, unit, seasonality, grade/quality, indicative price and how that quantity was verified.
- Obtain at least 2–3 current supplier/producer quotes for material assumptions.
- Check whether available resources are legally and sustainably sourced.

### Gate 2 — Verify a real buyer problem
- Identify a named buyer segment (households, food stalls, shops, hotels, processors, wholesalers or importers).
- Conduct around 10 exploratory buyer interviews as an initial screen; ask about current buying behaviour, frequency, quantity, quality requirements and price paid. This is a practical heuristic, not a statistically representative sample.
- For export hypotheses, identify actual importers/distributors and check product classification, packaging, quality, certificates, duties and delivery terms.

### Gate 3 — Calculate unit economics
Use actual local quotes rather than generic API proxies:
- selling price per unit confirmed with buyers;
- material + yield loss + labour + energy + packaging;
- transport, platform/reseller fees, tax/permits and spoilage/returns;
- gross contribution per unit, minimum viable batch and break-even quantity;
- working-capital requirement and payment-delay risk.

### Gate 4 — Run a low-cost test
- Prefer pre-orders, a paid pilot, service trial, or the smallest safe batch over buying machinery.
- Record the number of people asked, quotes, conversion to paid orders, repeat orders, complaints, costs and actual margin.
- Mark evidence as `interview-only`, `quote-verified`, `paid-pilot`, or `repeat-sales-observed`.
- Only graduate a recommendation to stronger evidence when the corresponding records exist.

## Cost estimate

This is an implementation-level estimate, not a budget for the user's business:
- **Static MVP:** potentially Rp0 incremental hosting/API cost using GitHub Pages and open data within platform/provider policies, normal quotas and a public repository. Browser localStorage has no server bill but is device-specific.
- **Open-data refresh:** World Bank context is fetched directly in the browser (no API key required); the Python job is focused on UN Comtrade's quota-limited endpoint. BPS/SIPEDAS and marketplace access must be checked individually. Avoid aggressive polling.
- **Community shared inventory:** requires a backend/database and moderation; free-tier availability and quotas can change. Keep private/community records out of public static JSON.
- **Commercial marketplace data:** may require approval or a paid provider contract; costs are not estimated until a concrete vendor, coverage and quota are chosen.
- **Field validation:** travel, sample testing, packaging, lab tests, permits and labour are variable local costs and are not covered by the API estimate.

## Roadmap

### API routing rule

- **Python/GitHub Actions collector:** use for quota-limited, keyed, approval-gated, expensive, or history-dependent APIs where server-side secrets and polite batching matter. Keep credentials in Actions secrets; never ship secrets to browser code.
- **Frontend direct fetch:** use for public, no-key sources that support browser CORS and reasonable request volumes (for example, World Bank context). Fetch asynchronously, cache for a sensible duration, and show a graceful fallback. "No API key" does not mean literally unlimited; respect provider policies and fair-use constraints.
- **Public map queries:** Overpass remains a user-triggered frontend lookup because the current workflow asks only when the user presses the search button. The public instance has usage limits, so avoid automatic/polling requests.

### Sales data and a 30-day trend

GPIR's current UN Comtrade feed is annual cross-border trade—not daily retail sales. It must not be relabelled as a 30-day sales trend. The architecture should support a rolling 30-day window when a source genuinely exposes completed-sales observations. Each daily aggregation should preserve `date`, `source`, `marketplace`, `product_query`/product identifier, `sold_count` (when returned), `median_sold_price`, `currency`, `geography`, `retrieved_at` and an explicit `evidence_type: "completed_sales"`. Keep only the window and source coverage needed for analysis, with attribution and terms respected.

If a source only exposes active listings, the same process may chart daily listing count and median asking price, but must label it `evidence_type: "listing_proxy"`—not sales. eBay Marketplace Insights is documented as a Limited Release product for approved developers; its official overview describes sold-item history for up to 90 days, so it is a potential connector only after access is granted. It is not treated as currently connected. See [official eBay overview](https://www.edp.ebay.com/api-docs/buy/marketplace-insights/static/overview.html).

### Phase 1 — Shipped starter
Local opportunity page, curated hypotheses, resource inventory in browser, GPIR trade-feed matching, asynchronous World Bank context in the frontend, and optional nearby mapped-place search.

### Phase 2 — Licensed / limited connectors
Add BPS, SIPEDAS or an approved completed-sales marketplace connector server-side only after credentials, access permission, data fields, refresh cadence and terms are verified. Use a scheduled Python job to publish permitted aggregate snapshots and retain enough history for a rolling 30-day trend. If no approved sales endpoint is available, show listing/price proxies separately and state that completed-sales data are unavailable.

### Phase 3 — Marketplace validation
Add approved listing APIs first. Store price/availability snapshots to calculate changes over time. Treat listing volume and search rank as proxies. Add sold-item datasets only if official access is approved.

### Phase 4 — Shared community resource registry
Add consent-based supplier and producer records, moderation, update history, data quality flags and role-based access. Store exact locations/contact details as private data; publish only coarse aggregates by default.

### Phase 5 — Evidence-informed recommendations
Keep fit score separate from market evidence. Add verified buyer quotes, trial orders and costs only when submitted/verified. Calibrate recommendation criteria using outcomes from pilots rather than retrofitting a “success probability” without data.

## Local testing

Open `enterprise.html` from GitHub Pages or serve the repository locally over HTTP. Geolocation requires a secure context (GitHub Pages HTTPS or localhost) and user permission. If denied, search for a location manually. Inventory uses browser localStorage. Public OSM service results can be incomplete; check places on the ground. Supplier/buyer links open query pages, not proof of stock, price, reliability or export feasibility.


## UX correction: matching, SMEs and map coverage
- Profile submission clears any category filter from the homepage and ranks all business types against resource/skill relevance. Matching uses word/phrase boundaries to reduce accidental substring hits; a vehicle used for delivery should not be mistaken for repair skill.
- The profile separates starting capital, intended enterprise scale (micro/small/medium/scale-up), geographic market, and buyer segment (households, MSMEs, business/institutional buyers, and importers/distributors).
- Nearby map mode supports a 1–15 km radius. Whole-city/administrative mode requires a manual search for a city/area name and uses the returned bounding box for the Overpass query and map extent. Broad queries can be slower; nearby results are cached in the browser.
- Active recommendation cards and the selected relationship step have a visible glow, respecting reduced-motion preferences.

## How the opportunity pathway works
1. Input and inventory: the visitor supplies available resources, skills, starting capital, desired business scale, buyer segment and market reach. Inventory entries stay in browser localStorage unless explicitly exported.
2. Opportunity matching: a curated catalogue contains resource/skill keywords, candidate products/services, indicative pilot-capital ranges, buyer hypotheses, setup needs and first validation steps. GPIR ranks opportunities using resource and skill matches, selected target market, buyer segment and scale. The score is an input-fit screening score, not a probability of success.
3. Local place signals: geocoding identifies the searched location. Overpass queries mapped OSM shops, food businesses, makers, suppliers and relevant facilities within a radius or the selected search-result bounding box. These are mapped places, not verified customers, sales, stock availability or exact administrative polygons.
4. External-market context: UN Comtrade snapshots add annual cross-border product flows, while World Bank indicators add country-level macro context. Matching by text/HS names is exploratory. Import values are not retail orders.
5. The five-step visual connects local inputs → possible product/service → candidate customer segment → mapped nearby place → external trade/search signal. These links are hypotheses, not established commercial relationships.
6. Validation loop: shortlist an idea, confirm supply price and quality, interview potential buyers, test a tiny batch or pre-order, record real sales/costs/repeat orders, then use these outcomes to refine recommendations.

## Data connector roadmap and evidence types
Keep different source types separate:
- Connected now: UN Comtrade scheduled snapshot (annual trade flow), World Bank country indicators (macro context), and OpenStreetMap geocoding/place discovery (mapped places).
- Potential local-supply connectors: BPS WebAPI (regional statistics) and SIPEDAS Kementan (agricultural production). Use Python/Actions for token-limited or scheduled retrieval, normalize to JSON, cache results and keep tokens out of browser code. SIPEDAS documents geography levels down to kecamatan for some modules; actual fields vary by module/year.
- Product catalogue: Open Food Facts can help compare packaged product variety, brands, categories, ingredients and packaging metadata. It is not sales volume. Search calls should be explicit user actions and respect its published rate limits.
- Search-interest proxy: Google Trends API would help analyze trends by region and time, but official docs still describe alpha access requiring approval. Do not depend on it until access exists.
- Active listing/asking-price proxy: eBay Browse API can show active listings/prices with application tokens. Collect authenticated snapshots server-side rather than expose application credentials in frontend JavaScript.
- Completed-sales evidence: eBay Marketplace Insights could support a rolling 30/90-day sales signal only after approval for its Limited Release. If access is unavailable, show no completed-sales chart rather than mislabel active listings or imports as sales.
- Agriculture and trade context: FAOSTAT provides food/agriculture production and trade context, not local buyer leads. UN Comtrade is annual merchandise trade, not live marketplace sales.

### Keep the Python collector selective
Use the scheduled Python collector for APIs requiring a key, approval, fragile quotas, or recurring snapshots. Public/no-key sources may be called by the frontend at user action time where policy permits, with request throttling, attribution, caching and graceful failure. Marketplace secrets belong in GitHub Actions secrets, never in repository JavaScript. A rolling 30-day display is valid only for dated observations that actually measure completed sales; otherwise label it as listing count/asking-price or search-interest trend.


## Tourism and visitor-linked local economy data
The scheduled Python collector is \`pipeline/fetch_tourism_data.py\`. It produces four independent snapshots:
- \`data/tourism_places.json\`: OpenStreetMap attraction/craft/souvenir records and Wikivoyage guide metadata around configured seed areas, plus OpenTripMap records when \`OPENTRIPMAP_API_KEY\` exists.
- \`data/ich_heritage.json\`: UNESCO DataHub dataset \`ich001\`; use as cultural context, not coordinates of active artisans.
- \`data/food_products.json\`: targeted Open Food Facts packaged-food catalogue queries; it is not transaction volume, current stock or market share.
- \`data/tourism_stats.json\`: annual World Bank \`ST.INT.ARVL\` country-level international arrival context. The UN Tourism Statistics Database is marked access-required: its public page says free access for student/researchers requires a formal written request; GPIR does not scrape it or claim an unauthenticated API integration.

Set optional repository secret \`OPENTRIPMAP_API_KEY\` to enable OpenTripMap snapshots. Without it, the collector still fetches public OSM, Wikivoyage, UNESCO, Open Food Facts and World Bank data where endpoints respond. Failed sources do not stop other collectors, and existing useful snapshots are preserved if a source returns no usable records.

Dynamic proximity remains based on the visitor's current/selected coordinates and on-demand nearby OSM query. The proximity bands are **very close ≤1 km**, **nearby ≤3 km**, and **outside the local-tourism boost >3 km**. If the UI's general map radius is 10–15 km, that wider radius is for exploration only; it must not cause a 10 km attraction to be described as nearby. No precise visitor coordinate is sent to the scheduled backend.

The collector stores metadata/title/coordinates for Wikimedia/Wikivoyage rather than article bodies, adds required source attribution and license notices, and keeps the source evidence types distinct. Tourist attractions are map leads; a mapped POI is not a verified visitor count, customer, seller, stock or order.


### Initial snapshot and refresh controls
The one-time collector bootstrap is explicitly triggered by the commit message token `bootstrap-tourism-snapshot`; it refreshes tourism/culture/product snapshots without re-running the quota-limited UN Comtrade collector. After that, the existing weekly schedule and manual workflow dispatch perform the regular combined refresh. The OpenTripMap connector remains optional behind the `OPENTRIPMAP_API_KEY` Actions secret; no client-side API key is required. Successful CI tests only prove normalization/structure and do not themselves imply any live API returned data.
