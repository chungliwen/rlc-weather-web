# Verification record

2026-10-11, Node 24.19.0, original Ruby reference commit `bd432c496e59d0549d614b30051e1beae637beef`.

- 47 Node tests passed, zero failed, zero skipped when run alongside original Ruby source with Ruby 4.0.1
- Actual Ruby parity covered forecast amount/probability/thunder scoring, AQI boundaries/guidance, heat index, all four report blends, Mercator geometry and radar summary
- Syntax checks passed
- Wrangler 4.149.0 deployment dry-run passed: approximately 30.50 KiB JavaScript (9.72 KiB gzip), three static assets. This is a build check, not deployment or runtime CPU verification
- Local synthetic preview HTTP returned the sample JSON successfully
- Independent code review found request-time freshness, 304 validator and stale UI remnants issues; all corrected, with source-age/session regression tests added
- Browser visual screenshot attempt was blocked by the cloud execution sandbox's browser socket restriction. No visual-browser pass is claimed

Not performed: live deployment; actual Cloudflare cron CPU profiling; live MET/IQAir/RainViewer integration validation; IQAir license verification; real VPS pipeline integration. No production credentials used. A standalone export deliberately skips two optional Ruby-reference tests if original source is absent; all remaining deterministic tests remain available offline.

Coverage gaps: radar tests use synthetic RGB/RGBA PNGs, not a captured live-provider corpus; unsupported PNG formats fail closed. Report wording/design are a first iteration. The heuristic is not a calibrated weather model, storm motion estimate or court-safety certification. No WhatsApp delivery has been ported or enabled.

Additional measurements:
- Actual local Wrangler/workerd integration was attempted, but the runtime could not start: `uv_interface_addresses returned Unknown system error 1` in this restricted cloud executor. Thus scheduled/fetch integration is tested through real exported handlers with mocked fetch/KV in Node, not a passing workerd session
- Ten Node runs of six synthetic 256×256 RGBA/Paeth radar frames took 14–43 ms wall time and 18–75 ms process CPU time (rounded; includes startup/JIT and Node's execution model). This is not a Cloudflare CPU measurement. It is enough reason not to promise Cloudflare Free's 10 ms budget; the portable VPS path avoids that constraint
- Standalone clean export: 47 tests discovered, 45 passed and two optional original-Ruby comparisons skipped, zero failures. The source-adjacent validation passed all 47 with zero skips
- Clean export was allowlisted from application source/docs/tests/assets/manifest/lockfile, excluding node_modules, runtime state, .wrangler, secrets, and original operational files/history. A targeted scan for common credential tokens, private keys, WhatsApp identifiers, private local paths and author identifiers returned zero hits. Fixture strings such as `fixture-secret` are intentionally fake test inputs

- VPS end-to-end pipeline test passes with six synthetic radar PNG responses actually decoded and sampled, producing the expected overhead echo. Node HTTP smoke test returned 200 for static page and persisted API report. MIT license added with repository owner approval.
