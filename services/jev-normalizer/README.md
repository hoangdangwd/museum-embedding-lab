# Jev external image normalizer

This is the separate trusted normalizer for option 2. It is intentionally not part of the Cloudflare Worker bundle.

## Contract

`POST /v1/normalize`

Headers:

- `Authorization: Bearer <JEV_NORMALIZER_TOKEN>`
- `Content-Type: image/jpeg`
- `X-Normalization-Version: rgb-oriented-bilinear-jpeg95-fit1568-pad280-v1`
- `X-Source-Sha256: <sha256 of request body>`

The response is a JPEG with:

- `Content-Type: image/jpeg`
- `X-Normalization-Version` matching the request
- `X-Source-Sha256` matching the request
- `X-Output-Sha256` matching the response body
- dimensions 280..1568, with no enlargement beyond 1568

The service must run behind HTTPS, require a random token, use no public image storage, and have request/body logs disabled. It returns 429 when its bounded codec pool is full. The Worker treats every protocol, hash, size, timeout, status, or content-type failure as Jev unavailable; it never falls back to local WASM in remote mode.

## Local verification

```bash
JEV_NORMALIZER_TOKEN='local-only-random-token' node server.mjs
```

This local command is only a codec/protocol check. It is not a production endpoint. Do not put a local tunnel URL in `wrangler.jsonc`.

## Production prerequisite

The endpoint must be hosted on an approved external CPU service before setting `JEV_IMAGE_PROCESSOR=remote` and `JEV_NORMALIZER_URL`. No hosting provider, URL, secret, budget, or retention agreement is configured by this repository. Jev remains `off` until that prerequisite and a load test are complete.
