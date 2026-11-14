# Production Jev v2 (reject-only)

The owner explicitly requested immediate production completion after reviewing the observed tradeoff. The production implementation is complete, but the live top-level configuration is currently `JEV_MODE=off`: Cloudflare Workers Free's 10ms CPU limit caused repeated `exceededCpu`/HTTP503 during consecutive live normalization checks. The baseline was redeployed to keep the site available. Owner requested option 2: the external normalizer implementation and precomputed reference cache now exist, but no external hosting/HTTPS endpoint/secret is configured. Do not turn enforce back on until that service is independently hosted, its privacy/logging settings reviewed, the cache is verified and repeated live load checks pass. No Workers plan has been purchased. Development remains `off`; there is no required multi-day shadow/canary waiting period once the infrastructure blocker is resolved.

## Decision contract

Only an already recognized result after baseline threshold/margin, semantic policy and existing hard-negative guards reaches Jev. One call compares query IMAGE1 with the **exact reference view that won the unrounded/exact cosine ranking**, IMAGE2. Equal-score view ties use vector ID lexicographic order for reproducibility.

Fixed model `typesafe/jev-1.14`, response `typesafe/jev-1.14-20261014`, provider `TypeSafe`, decisions endpoint `https://openrouter.ai/api/alpha/decisions`, prompt `jev-symmetric-identity-v2`, cutoff0.5, five-second provider deadline. No runner-up switching, no reference substitution, reverse-order max/OR, retry-to-pass, rescue of baseline rejects or catalog writes.

- Confirmed score>=0.5: retain original top-1.
- Below0.5: `uncertain`, reason `pairwise_identity_not_confirmed`.
- Error/timeout/invalid response/reference/normalization/quota/circuit/accounting failure: `uncertain`, reason `pairwise_verifier_unavailable`.
- Both veto paths clear `artifact_id`, `artifact`, `source` and `decision_source`. Candidates remain diagnostic, never primary identity.
- `/api/v1/recognitions` retains existing idempotency; replay never calls any provider again. Admin UI does not automatically resubmit failed requests.

## JPEG runtime

Production is configured for `JEV_IMAGE_PROCESSOR=remote` (Jev still off). The Worker sends the exact baseline query bytes as a bounded JPEG binary POST to an authenticated HTTPS service, validates source/output SHA-256, normalization version, framing, size and deadline. It reads a precomputed reference from a separate R2 prefix and verifies its output digest against the compiled cache manifest. There is NO local codec fallback on service/cache failure. Explicit `JEV_IMAGE_PROCESSOR=local` remains for regression tests/legacy diagnostics only.

The separate Node worker-thread service in `services/jev-normalizer/` uses the same `@jsquash/jpeg` WASM/libjpeg and `normalizeWithCodec()` implementation: RGB8,64..1600,4MiB max before decode, orientation applied, fit inside1568 without enlargement, white pad to at least280 per side, JPEG95, no EXIF/comments. Bilinear is not Sharp/Lanczos from research: production encoding is **not byte-identical to research normalization**. Offline model outputs are not substituted for live results. Original embedding inputs and R2 reference bytes/vectors remain unchanged.

R2 object bytes must match the exact D1 winner digest and build-time approved release/signature/externalID. Missing or corrupt provenance fails closed. No client vector/reference/provider/model/threshold overrides.

## Budget and circuit

Migration0007 creates independent `jev_attempts` and `jev_circuit`; embedding `usage_buckets`/`worker/limits.js` are unchanged.

| Variable | Production |
|---|---:|
| `JEV_MODE` | `enforce` |
| `JEV_DAILY_LIMIT` |100000|
| `JEV_DAILY_BUDGET_MICROUSD` |5000000 ($5/day)|
| `JEV_MAX_CONCURRENCY` |2|
| `JEV_TIMEOUT_MS` |5000|

These are safety ceilings, not expected spend or a guaranteed invoice cap. Atomic D1 INSERT checks UTC count, charged/reserved cost, global active leases and circuit together. Reserve12,000 microUSD per attempt, conservatively exceeding full262144-context cost at verified $.042/M input pricing. Settle to rounded-up reported actual cost; unknown/timeout/abandoned outcomes keep the whole reservation. Known pre-network validation failures settle zero. Five consecutive verifier failures open circuit60seconds; a subsequent valid result resets consecutive failures. Expired60-second leases stop occupying concurrency, never silently refund money or retry. Requests rejected by budget/concurrency/circuit return uncertain, not a baseline match.

A future provider price change can exceed the reservation assumption; unexpected reported cost above it is unavailable and counted in full. Review `/api/admin/jev` and account billing. No claim that historical research lifetime invoice was reconciled.

## Privacy review

UI discloses sending the query through OpenRouter to Google (existing pipeline), and possibly TypeSafe (new identity check), before recognition. Avoid faces/documents/private data; only museum artwork images should be uploaded. Integrating backends must provide equivalent notice/consent where applicable.

Reviewed public policies2026-11-14:

- https://openrouter.ai/privacy
- https://typesafe.ai/legal/privacy-policy
- https://typesafe.ai/legal/terms

TypeSafe policy states Input is not used to train/fine-tune models, but retention is **as reasonably necessary**, and processing is hosted in the US. This is NOT verified zero-data-retention and NOT a claim of local-only/private processing. No custom enterprise retention agreement was obtained. Do not send confidential/customer PII merely because this model verifies artwork.

Our Jev table stores only random internal attempt IDs, timestamps, state, cost-known/charged-cost and elapsed time, retained7days. It stores no query/reference JPEGs, hashes, names, descriptions, prompt, provider raw body, user/IP identifiers or secrets. Runtime logs contain an allowlisted verdict event and timing/cost-known boolean, never arbitrary provider exceptions. Existing integration response/idempotency retention remains24hours and is unchanged.

## External normalizer provisioning

Run `node scripts/prepare-jev-references.mjs` offline: this creates ignored derived JPEGs and the pinned `data/jev-reference-cache.json`, with no providers, labels, split, original JPEG or vector changes. Authenticated admin `PUT /api/admin/jev/references/:source_sha256` accepts only the exact output pinned in this manifest for an active approved reference, storing a separate object under `jev-derived/<normalization>/<source-digest>.jpg`. `GET` verifies readiness. There is no arbitrary client-provided reference/vector acceptance.

Host the service behind HTTPS with a random >=32-character `JEV_NORMALIZER_TOKEN`, no image/body/request logging and no image persistence. Set server-only Worker `JEV_NORMALIZER_URL` and the same token as a secret. No hosting credentials/endpoint exist yet; the repository does not create or bill a third-party host. A local or tunneled laptop service is NOT production readiness. See `services/jev-normalizer/README.md` for deployment instructions.

## Operations and rollback

`GET /healthz` includes `jev` mode. `GET /api/admin/jev` uses existing admin authorization and reports limits/usage/states/circuit. Catalog/index checks remain `/api/admin/catalog-release?check_index=1`. Current online health must show `jev: off` until the CPU blocker is resolved.

To turn Jev off: set top-level `JEV_MODE` to `off` in `wrangler.jsonc`, run relevant tests/build and `npm run deploy`, then verify health shows off. Preserve all other vars, bindings and secrets. Keep migration0007/data; no catalog seeding or deletion required. Full pre-Jev rollback version is `4a67e66b-c4f5-44ff-bf14-c40197a0064a`.

Known quality tradeoff: research391known baseline accepts→390,8observedconfuseraccepts→0; R0606 glare/Hoanghau becomes uncertain. Finite correlated development evidence, not independent production accuracy. See ignored `reports/jev-comprehensive-v3/decision.md` for full evidence and `reports/jev-production-v1/` for deployment diagnostics.
