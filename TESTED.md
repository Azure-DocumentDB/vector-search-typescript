# Validation boundary

## Local checks — 2026-10-12

Node24.21.0 / npm11.19.0 on macOS arm64; strict TypeScript7.0.2, MongoDB7.7.0, Azure Identity4.13.3. `npm ci`, build, strict typecheck (`npm run lint`), and the **33/33 production-code/CLI subprocess tests** pass locally (zero skips). Tests use local in-memory store/transport doubles. An explicitly test-only Node module hook drives the actual CLI failure/exit-code matrix (connection/index/write/empty/rank/close errors); it is never loaded by normal/live commands or used as live evidence. No model calls, Docker or cloud provisioning were performed by the code worker.

Full and production-only npm audits report **zero known vulnerabilities** at this date. No advisories are ignored/overridden. Audit counts are point-in-time, not a security guarantee. CI is configured but not claimed remotely run by these local results.

The pinned real fixture is separately checked locally for50 unique hotels,1536 dimensions, SHA-256, query extraction, finite vectors and independent COS/L2/IP top5 ranks. The synthetic metric fixture deliberately has different nearest-neighbor rankings for COS, L2 and IP to detect an accidentally shared metric oracle.

## Live Azure gate — operator-owned, not established by local tests

`LIVE_AZURE_TEST=true npm run test:live` is an explicit real Azure gate, not a unit test and not a skip. It requires the documented disposable namespace/write/auth configuration. All algorithm/metric cases must pass the independent rank oracle in **both native SCRAM and Entra OIDC** modes, then pass an idempotent rerun, before claiming managed-Azure readiness. Publication operators should record dated server tier, exact commit, per-case evidence and cleanup result here. No Azure runtime success is asserted by this file yet.

Embedding generation/natural-language inference is intentionally removed. Precomputed fixture success never implies model availability or semantic quality. Small-fixture rank matching is not a production-scale ANN performance guarantee.

## OIDC username constructor regression — 2026-10-12

Parent live diagnostics found that MongoDB7.7.0 rejects a username-only `auth` object before connection. The driver option parser requires both username/password keys; its OIDC validator permits an empty password and rejects a nonempty one. Production configuration now uses `auth: { username, password: '' }` when an OIDC principal identifier is supplied, retaining `MONGODB-OIDC`, `$external`, the same callback/audience and TLS validation. There is no native credential fallback.

The added regression first reproduced the exact parser error, then passed against the real production `makeClient` and real MongoClient constructor with a nonempty synthetic principal ID. It does not connect, resolve DNS, request a token or mock the constructor. Both full local suites pass32/32 with zero skips after correction; parent owns post-fix Azure native/OIDC reruns.

## OIDC resolved Azure host gate — 2026-10-12

MongoDB7.7.0 `MongoClient._connect` validates resolved SRV hostnames against `authMechanismProperties.ALLOWED_HOSTS` after DNS resolution but before topology connection/token acquisition. The default list only covers MongoDB domains and localhost, so Azure shards fail. The supported public driver property now explicitly allows only the validated endpoint's public-Azure DocumentDB DNS tree: `*.global.mongocluster.cosmos.azure.com` for a global endpoint, otherwise `*.mongocluster.cosmos.azure.com`. No universal/broad-Azure wildcard or ENVIRONMENT bypass is used. TLS, endpoint validation, callback and fixed token audience remain unchanged.

The regression executes the real driver `MongoClient.connect` host-check code with synthetic resolved SRV addresses. Only DNS results and topology connection are intercepted (the latter stops before network), and credential acquisition is counted. Expected Azure shard names with service port10260 pass the actual gate; unrelated domains, Azure/MongoDB lookalikes, suffix attacks, sovereign-cloud hosts and localhost fail with zero topology connection and zero token acquisition. Internal driver imports are confined to this version-pinned test probe. Before fixing, the test reproduces the exact managed-service ALLOWED_HOSTS failure. After fixing, both local suites pass33/33, zero skips; managed-Azure reruns remain parent-owned.
