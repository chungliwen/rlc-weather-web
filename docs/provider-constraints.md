# Weather Worker: provider and runtime constraints

Verified against official documentation on 2026-10-11. These are implementation and release checks, not a guarantee that an account's plan or data license permits deployment.

## Cloudflare execution

- An every-ten-minute Cron Trigger is below the one-hour threshold: **Free allows 10 ms CPU per invocation; Paid allows 30 seconds**. The 15-minute cron wall-clock limit is separate. Waiting for network/KV does not consume CPU, but parsing radar images and JSON does. Benchmark on the target plan; do not promise Free compatibility from passing Node tests.
- Memory is 128 MB. Free permits 50 external subrequests per invocation and six simultaneous outgoing connections. Bound fetch concurrency and image/frame count; release response bodies promptly.
- Free allows 100,000 Worker requests/day, resetting at midnight UTC, and five cron triggers/account. Use one scheduled refresh and serve cached snapshots; public reads must not trigger an upstream refresh.
- Paid cron intervals of at least one hour allow 15 minutes CPU, but changing the interval changes product freshness. It is not an optimization for a ten-minute refresh requirement.

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### Assets and persistent state

- Static Asset requests are free and unlimited, with no extra asset-storage charge. Worker-first routing invokes billable/limited Worker execution; prefer normal asset routing for HTML, CSS and client JS.
- Static Assets are deployment content. Publish changing weather JSON through the Worker from KV, rather than treating the packaged asset directory as a writable runtime filesystem.

Source: [Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)

- KV Free: 100,000 key reads/day; 1,000 key writes/day; 1,000 deletes/day; 1,000 list requests/day; 1 GB stored. Exceeding a daily quota makes that operation fail until the UTC reset. Bulk writes still count per key.
- Budget example: 144 ten-minute ticks/day × six written keys = 864 writes/day, leaving 136 for manual refreshes/retries/other account usage. Seven keys each tick = 1,008 and exceeds Free. Prefer a bounded combined snapshot/state document and avoid writing unchanged provider data.

Source: [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)

- KV allows one write/second to a given key, values up to 25 MiB, and 1,000 KV operations/invocation. Serialize writes to the same key.

Source: [KV limits](https://developers.cloudflare.com/kv/platform/limits/)

- KV is eventually consistent: readers elsewhere may see old values for 60 seconds or more (or the configured cache TTL). It is unsuitable as a globally reliable lock. Use a single scheduled writer, tolerate stale reads, and carry source timestamps in snapshots. Strong concurrency control needs a stronger coordinating store.

Source: [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)

## MET Norway forecast

- Send an honest identifying `User-Agent`: application/domain and a real contact email or website. Make this explicit configuration; never invent a contact or use a generic browser UA.
- Cache the response body with exact `Last-Modified` and `Expires`. Before expiry, skip the upstream call. After expiry send `If-Modified-Since` with the stored header value. On 304 preserve the existing body and update cache headers; do not parse an empty 304 as JSON.
- Use HTTPS; truncate coordinates to at most four decimals. Stagger requests away from common minute boundaries; a ten-minute scheduler can check eligibility without making ten-minute upstream calls.
- Back off on 429 and preserve last-known-good data on failures. Display observation/forecast times and stale status.
- Credit MET Norway and link CC BY 4.0; indicate derived/transformed data. Do not imply endorsement or use Yr branding as the product's identity.

Sources: [MET terms](https://api.met.no/doc/TermsOfService), [Locationforecast HOWTO](https://api.met.no/doc/locationforecast/HowTO), [data licensing](https://api.met.no/doc/License)

## RainViewer radar

- The dated transition notice says that from **2026-01-01**, future/nowcast radar and satellite IR are discontinued. Remaining Weather Maps data cover the previous two hours at ten-minute intervals. Read `radar.past`; an absent/empty nowcast array is normal, not a provider outage.
- Maximum zoom is 7; Universal Blue is the remaining color scheme; rate limit is 100 requests/IP/minute. Cache the manifest and timestamped tiles, use bounded retries, and never bypass limits.
- Label any locally extrapolated prediction as an estimate made by this application, not a RainViewer-supplied forecast. Historical tiles alone do not establish future precipitation.

Sources: [2026 transition summary](https://www.rainviewer.com/api/transition-faq.html), [Weather Maps API](https://www.rainviewer.com/api/weather-maps-api.html)

- The free terms identify personal/educational use; the FAQ also mentions small community projects and asks commercial integrations to arrange separate terms. Do not assume a commercial HeySubang deployment is licensed.
- Display visible linked credit to RainViewer. Attribution does not itself grant commercial permission.
- The general API FAQ still mentions nowcasts and no published hard limit, conflicting with the dated transition page. Implement the stricter, dated 2026 constraints above and seek provider clarification if needed.

Source: [RainViewer API terms and FAQ](https://www.rainviewer.com/api.html)

## IQAir / AirVisual

- The public Community API plan lists 5 calls/minute, 500/day and 10,000/month. All limits apply. Keep the API key in a Worker secret and out of client assets, public JSON, logs and repository files.
- A single city refreshed hourly uses 24 calls/day and at most 744 per 31-day month. Ten-minute polling consumes six times as much without establishing fresher measurements.

Source: [IQAir API plans](https://www.iqair.com/sg/commercial-air-quality-monitors/api)

- Official API documentation says stations update only once per hour and may omit pollution values for an hour. Cache for at least an hour, preserve source timestamps, and retain last-known-good values with a stale indicator rather than publishing missing values as zero.

Source: [AirVisual API documentation](https://api-docs.iqair.com/)

- **Public-display rights remain a release gate.** API marketing describes dashboards/broadcast use, but the general terms provide personal/non-commercial access and restrict commercial reproduction/public display absent permission. Account-specific API terms or a written grant may govern the integration; they were not available in this public-doc check. An API key or attribution alone does not demonstrate permission.
- Before enabling public IQAir output, verify the specific account/plan permits this site's display, caching and redistribution. Once allowed, include required IQAir ownership/attribution notices. No account action, contact request, or license acceptance was performed for this research.

Sources: [IQAir terms, intellectual property and permitted use](https://www.iqair.com/ae/legal/terms-conditions), [IQAir API plans](https://www.iqair.com/sg/commercial-air-quality-monitors/api)

## Recommended release gates

1. Target-plan CPU/memory verification with realistic radar frames; Free is unproven until measured.
2. All public reads serve cached results; scheduled work alone refreshes providers.
3. A write-budget test for worst-case daily KV usage including retries/manual refreshes.
4. Real MET contact identification, cache-header behavior and visible licensing attribution.
5. Radar historical-only behavior, zoom/rate limits, visible attribution and use-case rights confirmed.
6. IQAir public output disabled until account-specific display rights are verified; hourly cadence and secret handling tested.
7. Failure tests retain a last-known-good snapshot with honest freshness metadata; no synthetic observations replace missing real data.
