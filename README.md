# RLC court conditions

A small, portable JavaScript weather report for Royal Lake Club, Kuala Lumpur. Plain HTML/CSS/JavaScript, no frontend framework and no runtime npm dependencies. The same calculations run on Cloudflare Workers or Node 22+ on a VPS.

## Work locally without credentials

```sh
cd workers # omit if this directory is the repository root
npm test
npm run check
npm run preview
# Open http://127.0.0.1:8788
```

Preview uses explicitly labelled synthetic data. It never contacts weather providers or writes production storage. `npm run sample` regenerates `sample-report.json`. Node's built-in test runner covers adapters, scheduled/fetch handlers, cache behavior, stale/partial/error data, PNG validation, source attribution, and MYT session boundaries.

Ruby comparison tests run when Ruby and the original sibling `lib/rlc_weather` sources are present. Set `RUBY=/path/to/ruby` if needed; clean standalone exports explicitly skip these two historical-reference tests while retaining the JavaScript fixture tests. No production credentials are needed for tests or preview.

## Architecture

- `src/weather.js`: pure forecast, AQI, heat-index, session and risk calculations
- `src/radar.js`: bounded historical PNG decoding and nearest-rain heuristic, max six 256px frames
- `src/providers.js`: fixed upstream endpoints, eight-second timeout, bounded JSON, per-provider caching
- `src/index.js`: scheduled refresh, one persisted JSON snapshot, read-only `/api/report`
- `public/`: static page; refreshes the saved report once a minute
- `scripts/node-adapter.js`: atomic filesystem storage, guarded refresh CLI, localhost-only HTTP server

A 10-minute scheduler means 144 refresh opportunities/day, not a request to every provider each time. MET waits until at least its `Expires` and uses conditional requests. Radar metadata refreshes at most every ten minutes and decoded results are reused for the same generation. IQAir defaults to two hours (12 requests/day), gated off until both credentials and public-display rights are confirmed. HTTP errors honor Retry-After; other failures wait until the next provider interval. Raw IQAir payloads, API request URLs and secrets are never persisted or returned. Forecast and radar retain only public provider data.

The Worker writes one combined state key each tick (144 normal writes/day); there is no public refresh endpoint. KV is eventually consistent and has no compare-and-swap lock: use one scheduled writer only. Do not configure duplicate schedulers or use KV as a strict quota/locking system. The VPS adapter has an exclusive refresh lock and atomic rename. If a process is killed, inspect running jobs before removing a leftover refresh.lock.

## VPS path (recommended first release)

No npm install is required for runtime. Do not place the state directory under a public web root. Prepare a protected environment file outside this repository containing a real MET identifying User-Agent and optionally approved IQAir settings; keep it mode 0600. Do not paste credentials into code or source control.

```sh
WEATHER_DATA_DIR=/var/lib/rlc-weather \
MET_USER_AGENT='rlc-weather/0.1 https://your-real-site.example/contact' \
node scripts/node-adapter.js --once

WEATHER_DATA_DIR=/var/lib/rlc-weather PORT=8788 \
node scripts/node-adapter.js --serve
```

Replace the example contact with an actual monitored contact/application URL. The server defaults to 127.0.0.1. The container image explicitly binds to 0.0.0.0 inside its private container network; publish its port only on host loopback. Integrate with your existing reverse proxy, process manager and build pipeline after checking their actual configuration; this project does not assume a particular VPS layout. A cron template is `*/10 * * * * cd /absolute/path/to/project && /absolute/path/to/node scripts/node-adapter.js --once`; supply the same protected environment to the timer and service. Do not run the Worker cron and VPS cron against the same quota budget without accounting for both.

## Cloudflare path (approval and setup required)

```sh
npm ci
npm run dev
# Local Wrangler scheduled test:
# curl 'http://localhost:8787/__scheduled?cron=*/10+*+*+*+*'
```

Before a real deployment:
1. Set a real `MET_USER_AGENT` in deployment configuration
2. Provision an authorized KV namespace and replace the deliberately invalid placeholder ID
3. Choose the route/domain and enable it deliberately (`workers_dev` is false in the template)
4. Benchmark actual cron CPU on the intended plan. Free has only **10 ms CPU**; a ten-minute Paid cron has **30 seconds CPU**. Radar PNG decoding is not yet proven within Free. Prefer the VPS path if this is troublesome; do not silently upgrade to a paid plan
5. If IQAir is wanted, verify the account's public-display rights and quotas, then configure `IQAIR_API_KEY` as a server-side secret and set both `IQAIR_ENABLED` and `IQAIR_DISPLAY_RIGHTS_CONFIRMED` to `true`. Leave it off until then
6. Verify live provider access, regional coverage, freshness, scheduler logs and failure alerts. Local tests are not a live-provider or production-SLA check

No account, credential, live deployment, paid-plan, WhatsApp or Mac changes are part of this implementation.

## Intentional differences from Ruby

- Current/next session follows MYT calendar boundaries rather than nearest historical issue slot. At 08:00 the late-morning session takes over; at 19:30 tomorrow's morning session is selected
- Current forecast uses the remaining playing window; missing hourly rain coverage or future timestamps cannot become a false-low score
- Stale or undated radar cannot drive risk; actual latest frame age is checked, not only metadata generation
- Failed latest radar tile is unavailable; missing earlier frames is marked partial. Clipped analysis radius fails closed
- Fresh forecast is required for numerical session rain risk. Present radar alone cannot establish tomorrow's conditions
- Provider freshness and session identity are rechecked on every API read. A report older than 20 minutes gives no current risk advice
- RainViewer contributes historical observations only, not future nowcast. The approach heuristic is not storm tracking or a calibrated probability
- AQI remains city-level US AQI, not Malaysian API or a club-local measurement. Stale AQI numbers are suppressed by the UI

Original forecast scoring, AQI categories/guidance, heat-index formula, geographic calculations, nearest-rain heuristic and four slot blends were checked against the original Ruby implementation. Whole-hour overlap totals are deliberately preserved rather than prorating partial hours.

## Attribution and release review

See `docs/provider-constraints.md` for official sources, provider rights and Cloudflare limits. MET data is CC BY 4.0. RainViewer attribution is required; confirm usage terms for the intended audience. IQAir display permission is account-specific. Software licensing does not grant weather-data rights.

The clean export excludes original repository history, operational delivery configuration, contact identifiers, logs, live reports, credentials and node_modules. Source code is released under the MIT license in LICENSE, with owner approval. Weather data remains subject to its providers’ separate terms. Wrangler is development tooling (MIT); this application's runtime uses platform APIs only.
