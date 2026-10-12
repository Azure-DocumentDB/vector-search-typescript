# Upstream provenance

- Source repository: https://github.com/Azure-Samples/documentdb-samples
- Exact source revision: [f5a2675bbf349737234d0391e3ebee24b260e06f](https://github.com/Azure-Samples/documentdb-samples/commit/f5a2675bbf349737234d0391e3ebee24b260e06f)
- Source directory: [ai/vector-search-typescript](https://github.com/Azure-Samples/documentdb-samples/tree/f5a2675bbf349737234d0391e3ebee24b260e06f/ai/vector-search-typescript)
- Extraction date: 2026-09-30
- License: original Microsoft MIT notice preserved verbatim in [LICENSE.md](LICENSE.md)
- History model: independently maintained source snapshot, not a GitHub fork or ownership transfer

## Standalone adaptations

Source is at repository root. The README is rewritten for that layout, and placeholder-only configuration/data setup replaces reliance on the parent checkout.
- Adapted source file: `.env.example`
- Adapted source file: `README.md`
- Adapted source file: `package.json`

Hotel fixtures are not redistributed: [data/README.md](data/README.md) pins the original input locations and checksums. Saved output, Learn-only quickstart pages, and devcontainer automation are omitted. Shared infrastructure and root monorepo CI are not copied.

The original extraction retained dependency versions and algorithms. The 2026-10-12 downstream rewrite below intentionally supersedes that baseline; the recorded upstream source revision remains unchanged.

## Maintenance

There is no automatic synchronization. Review upstream changes against this pinned baseline, apply only relevant fixes, retain notices, and record the imported revision and local adaptations here.
Issue/PR history is not transferred. The maintainers of the repository hosting this extraction own its downstream fixes; contribute reusable fixes upstream under its contribution policy.

## Downstream safety and standalone rewrite — 2026-10-12

Replaced upstream model-dependent/destructive entrypoints with a shared, strict TypeScript precomputed-vector workflow: pinned50-hotel1536D data, exclusive-output query extraction, insert-only stable-ID upserts, per-case collections, fixed public-Azure OIDC audience and millisecond-to-second expiry, strict TLS/domain/auth-mode validation before credential construction, complete index-catalog conflict rejection, independent metric-rank oracle, bounded operations/cleanup, structured redacted failure output and aggregate nonzero status. Every selected case is attempted after earlier failure. No delete/reset/drop or inference code remains.

Updated dependencies to MongoDB7.7.0, Azure Identity4.13.3, TypeScript7.0.2 and Node24 types24.19.2; removed OpenAI. Lockfile reproducibility, production-code unit/mock/CLI tests, safe data fetch, read-only SHA-pinned GitHub CI, explicit non-skipping live gate, and truthful Node24.21.0 minimum are downstream additions. Vector and comparison TypeScript repositories intentionally share the same reviewed core with a small mode switch; fixes must be manually ported to both. Finished Go samples informed safety contracts, not wholesale copied implementation.

No cloud infrastructure is copied or provisioned. Model generation is intentionally out of scope, not claimed validated. See TESTED.md for local versus live evidence. Preserve the original MIT notice and dataset provenance.
