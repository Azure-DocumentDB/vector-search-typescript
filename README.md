# vector-search-typescript

**TypeScript / Node.js 24** samples for Azure DocumentDB (MongoDB compatibility): IVF, HNSW and DiskANN using **precomputed vectors, no model calls**. The managed Azure `$search` / `cosmosSearch` dialect is required; this is not a generic MongoDB example.

Derived from the [pinned Microsoft sample](https://github.com/Azure-Samples/documentdb-samples/tree/f5a2675bbf349737234d0391e3ebee24b260e06f/ai/vector-search-typescript). Original [MIT notice](LICENSE.md) retained; downstream changes and manual-maintenance policy are in [UPSTREAM.md](UPSTREAM.md).

## What this proves — and does not

The primary workflow uses the pinned **50-hotel, 1536-dimensional** dataset and a query vector extracted from its first record. It validates database authentication, insert-only seeding, vector-index catalog semantics, and nearest-neighbor ranks against an independent COS/L2/IP calculation. It is a small, non-semantic self-match correctness fixture, **not a performance benchmark, model-quality test, or natural-language search demo**. Raw scores from different metrics must not be compared.

Embedding generation and the old OpenAI dependency have been removed. There is no optional inference client, redirect/token forwarding path, model fallback, or billable model call. “Precomputed” does **not** mean the database is local or free: approved Azure compute/network/storage costs still apply. CI and local mock tests do not prove live Azure permissions or service-tier support. See [TESTED.md](TESTED.md) for the exact validation boundary.

## Prerequisites

- **Node.js 24.21.0 or newer patched Node 24**, npm, Git. `engines` deliberately excludes untested majors; Node 22 is no longer advertised. Run `npm ci` using the committed lockfile.
- An existing, explicitly approved **disposable public-Azure DocumentDB** cluster and deliberate network access. Confirm current region/tier support for all three algorithms in the [service documentation](https://learn.microsoft.com/azure/documentdb/vector-search). Do not provision infrastructure just to satisfy these commands without cost approval.
- Native SCRAM credentials, or `DefaultAzureCredential` with the correct Microsoft Entra principal registered for appropriate **database roles**. `az login` and subscription RBAC alone do not grant database access. [Connection/RBAC guidance](https://learn.microsoft.com/azure/documentdb/how-to-connect-role-based-access-control).

## 1. Install and prepare data (no Azure or inference)

Run from the repository root. POSIX shell examples; PowerShell users can set the same process variables with `$env:NAME = 'value'`.

```sh
npm ci
npm run build
npm test
npm run lint
npm audit
npm run data:fetch
npm run query-vector -- data/Hotels_Vector.json data/query-vector.json
```

The explicit `data:fetch` command downloads the exact revision/hash described in [data/README.md](data/README.md). Nothing downloads on clone/install/test. Downloads are bounded, HTTPS-only at a fixed GitHub URL, reject redirects, and verify SHA-256 **before** creating a file. An existing fixture is verified and never replaced; mismatch fails. `query-vector` verifies the same hash, extracts the first hotel's vector, and refuses to overwrite an existing output (including a symlink). Reuse a verified existing query file instead of rerunning extraction to the same path.

## 2. Choose a new disposable namespace

The programs read **only the process environment**; they never implicitly load or execute `.env`. [.env.example](.env.example) documents placeholders. Never commit a populated file, place credentials in command history, or print a connection string.

```sh
export MONGO_AUTH_MODE=oidc
export MONGO_HOST='<approved-cluster>.global.mongocluster.cosmos.azure.com'
export MONGO_DATABASE=vectorsearch_disposable_my_unique_run
export MONGO_COLLECTION_PREFIX=oidc
export VECTOR_SEARCH_ALLOW_WRITES=true
export DATA_FILE_WITH_VECTORS="$PWD/data/Hotels_Vector.json"
export QUERY_VECTOR_FILE="$PWD/data/query-vector.json"
```

Sign in to the intended tenant/principal and independently verify database roles. OIDC supports only the public Azure DocumentDB domains `*.mongocluster.cosmos.azure.com` and `*.global.mongocluster.cosmos.azure.com` with exactly one cluster label. Alternatively `MONGO_CLUSTER_NAME` constructs the latter hostname. The driver receives an explicit OIDC `ALLOWED_HOSTS` for that validated endpoint's Azure DocumentDB service DNS tree, so real SRV shard names pass its pre-auth gate while foreign hosts remain denied; TLS verification remains mandatory. Optional `MONGO_OIDC_USERNAME` identifies the principal where required. The current MongoDB Node **v1 callback contract** uses `timeoutContext: AbortSignal`; Azure's millisecond expiry is converted to a positive **seconds** lifetime. Null, empty, expired tokens and unknown callback versions fail. The fixed audience is `https://ossrdbms-aad.database.windows.net/.default`, never a server-provided issuer/scope/audience.

For native authentication set `MONGO_AUTH_MODE=connection-string` and securely inject `MONGO_CONNECTION_STRING` into the process environment. It must be an Azure `mongodb+srv://` URI with nonempty native username/password and **no database path**; `MONGO_DATABASE` selects the actual DB. SCRAM-SHA-256/SCRAM-SHA-1 and authSource=admin are supported. URI options are allowlisted: tls/ssl=true; TLS-bypass flags=false; retryWrites=false; supported authMechanism/authSource; simple appName. Unknown/duplicate options fail closed. Unset `MONGO_OIDC_USERNAME` in native mode and `MONGO_CONNECTION_STRING` in OIDC mode. Both modes validate domains/TLS/config/data before credentials or network, enforce certificate/hostname validation, and never fall back between authentication modes. Arbitrary gateways, localhost, sovereign clouds, custom CAs and TLS bypasses are intentionally unsupported.

## 3. Run the three cosine cases

```sh
npm start                         # IVF + HNSW + DiskANN, COS; all attempted
npm run start:ivf                  # optional individual case
npm run start:hnsw
npm run start:diskann

# Explicit publication/integration gate, same real workflow and strict rank oracle:
LIVE_AZURE_TEST=true npm run test:live
```

`test:live` **fails** without exactly `LIVE_AZURE_TEST=true`; it never silently skips. Use `node dist/cli.js --live` if stdout must contain only JSON (npm prints script banners). Every case gets a separate collection `<prefix>_<ivf|hnsw|diskann>_cos`. Every selected case is attempted even after an earlier failure. Results contain safe IDs/raw finite scores, seed counts, expected ranks, per-case status/errors, and aggregate succeeded/failed counts. Empty/malformed results, wrong rank, missing index, failed writes and close errors all produce exit1. Unsupported algorithms are failures, not green skips. Exceptions from drivers/SDKs/filesystems are redacted to a safe label plus numeric server code, never a connection string, token, document, or stack trace.

## Safety, idempotency and deadlines

- Writes require exactly `VECTOR_SEARCH_ALLOW_WRITES=true` and an explicitly named `vectorsearch_disposable_<lowercase_run_id>` DB, maximum63 characters. A fresh unique run ID and separate native/OIDC prefixes are recommended. A name guard is not an authorization boundary; use least-privilege roles.
- No `drop`, `deleteMany`, reset, replace, or automatic cleanup operations exist. All records and unrelated indexes are preserved. The operator owns eventual disposable-resource cleanup and costs.
- Each hotel gets its original string `_id`, or deterministic `vectorsearch:<HotelId>`. Seeding uses `_id`-filtered `$setOnInsert` upserts. Existing documents are **never updated**, even if changed externally; repeated runs report inserted0. Partial write failures can leave earlier insertions; the command fails and rerunning is safe.
- Entire pinned seed and finite, nonzero query vector validate before network/mutations. Query must have exactly1536 dimensions. An arbitrary same-dimensional vector is not evidence of model compatibility.
- Indexes are checked **before seeding, on every run**, including populated collections. Missing indexes are created and re-read. Conflicting vector definitions, compound keys, extra/missing vector options, sparse/partial/unique/TTL/hidden or unknown catalog semantics fail closed; nothing is dropped. Only version/namespace/background metadata and explicit false sparse/unique/hidden flags are tolerated.
- Small-fixture settings: IVF numLists1; HNSW m16/efConstruction64; DiskANN maxDegree20/lBuild50. These are not tuned production defaults.
- Each case has a configurable deadline (default120s, maximum300s), MongoDB client-side operation deadlines, bounded connection/socket/selection waits, abortable OIDC and query calls, and up to5s client/cursor-close grace. A final process watchdog bounds non-cooperating transport handles. Failed cases do not consume the next case's budget. Immediate index invisibility or empty results fail rather than hiding errors in retries; rerun safely once the service is ready.
- The strict independent top-K **rank** oracle is computed from the fixture, never from server scores. Tied/ambiguous oracle input is rejected. A changed stored fixture or unrelated nearby vector can correctly cause a quality failure; use a fresh collection rather than deleting records. Approximate search generally does not guarantee exact ranks: this is deliberately a narrow readiness gate on this small fixture.

## Configuration

| Variable | Contract |
| --- | --- |
| `MONGO_AUTH_MODE` | Required: `oidc` or `connection-string` |
| `MONGO_HOST` / `MONGO_CLUSTER_NAME` | Approved public-Azure FQDN or cluster label for OIDC |
| `MONGO_OIDC_USERNAME` | Optional OIDC principal identifier |
| `MONGO_CONNECTION_STRING` | Native SCRAM URI only; secret |
| `MONGO_DATABASE` | Required unique `vectorsearch_disposable_<run>` |
| `MONGO_COLLECTION_PREFIX` | Required lower-case identifier, 1–40 chars |
| `VECTOR_SEARCH_ALLOW_WRITES` | Required literal `true` |
| `DATA_FILE_WITH_VECTORS` | Default `data/Hotels_Vector.json`; pinned hash enforced |
| `QUERY_VECTOR_FILE` | Required precomputed JSON numeric array |
| `EMBEDDING_DIMENSIONS` | Fixed1536; other dimensions rejected |
| `LOAD_SIZE_BATCH` | Default50; integer1–1000 |
| `TOP_K` | Default5; integer1–50; unambiguous oracle ranks required |
| `VECTOR_SEARCH_CASE_TIMEOUT_MS` | Default120000; integer1000–300000 |
| `LIVE_AZURE_TEST` | `true` required only for explicit `--live` gate |
| `EMBEDDING_MODE` | Optional `offline` only; no inference implementation |

The field is deliberately fixed to `DescriptionVector`, source identity to `HotelId`, and the supplied dataset to its pinned hash. Unsupported overrides are not a general import API. Old `start:embed` and all-database `start:show-indexes` commands have been removed, not silently retained with different unsafe behavior. Normal runs already inspect only their selected collections' indexes.

## CI and maintenance

CI uses SHA-pinned GitHub-owned actions, read-only repository permissions, no retained checkout credential, and no Azure secrets/services/inference. It runs `npm ci`, strict TypeScript build/typecheck, production-code unit/mock and CLI subprocess tests, full and production dependency audits, and verifies the missing-live-opt-in failure. Live validation must be separately approved and run by an operator. See [TESTED.md](TESTED.md).

This is a downstream snapshot, not the complete upstream monorepo or infrastructure deployment. Review/port upstream fixes manually and update [UPSTREAM.md](UPSTREAM.md). Dataset hashes identify inputs, not a separate rights grant; original source terms remain in the data guide.
