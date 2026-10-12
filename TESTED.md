# Validation record — 2026-10-12

## Managed Azure result

**6/6 algorithm/authentication cases passed** on a disposable managed Azure DocumentDB M30 in West US2, one shard, MongoDB8.0 compatibility,128GiB storage and high availability disabled. The matrix is IVF/HNSW/DiskANN × COS, repeated under native SCRAM-SHA-256 and Microsoft Entra OIDC with verified TLS and a client-IP firewall.

Tested implementation: `62174c5ae6fd716e7147f6ef1567b02f40fe3423`. The later commit containing this record changes only documentation.

The fixture contains50pinned public hotel records with1536-dimensional precomputed vectors; the query is the first stored vector. Actual index definitions were checked. Every case returned five results checked against a numeric reference appropriate to its metric; raw scores from different metrics are not comparable. This is not a semantic-quality, latency/throughput, production-size ANN or service-tier support benchmark.

Actual command-line execution and repeat runs were checked, not merely client construction. Repeated seeding inserted zero duplicates. An unrelated sentinel survived in every exercised collection. Existing user edits were preserved by insert-only seeding or safely refused as a fixture conflict; no test path dropped/reset/replaced existing data or indexes.

Each CLI also rejected disabled write consent, a system database target, a foreign host and an incorrect native password with a nonzero exit and without printing credentials. No model calls or Azure OpenAI account were required.

## Issues discovered and fixed in real Azure testing

The initial OIDC run exposed two driver requirements missing from the first candidate: a nonempty username needs an auth object with both keys and an empty OIDC password; the driver's default ALLOWED_HOSTS list excludes Azure's resolved service-shard names. The final source supplies a narrow Azure DocumentDB DNS-tree allowlist after validating the original destination. It does not use a wildcard-all-hosts or native-auth fallback. Real Azure native and OIDC tests were rerun successfully after both fixes, followed by preservation reruns and independent top-five/known-ID/rank assertions.

## Local checks

Node24.21.0, MongoDB7.7.0, Azure Identity4.13.3.33 permanent production-code/CLI tests pass, none skipped. npm ci/build/typecheck pass; full and production audits report zero known vulnerabilities. Real driver-constructor and post-SRV-host-gate regressions cover nonempty OIDC usernames and denied foreign hosts.

Full repository history and tracked publication files were scanned for secrets with no matches. MIT licensing and pinned upstream provenance remain. Scans are point-in-time findings, not a guarantee of absolute security. CI uses pinned GitHub-owned actions, read-only permissions and no cloud credentials or deployment steps.

## Scope and cleanup

This repository supports precomputed database/vector workflows only; live embedding/model generation was removed rather than falsely advertised as tested. The available subscription's model-service eligibility is not needed by the quickstart. No model-backed end-to-end, high availability, backup recovery, production capacity or broader cloud support is claimed.

Testing used isolated disposable namespaces, not existing customer data. Environment owners are responsible for deliberately removing their test resources; the sample never automatically deletes databases/collections/indexes. The release operator verifies deletion of the shared test resource group and hosted CI before publication. No credentials, subscription identifiers or private infrastructure details are included here.
