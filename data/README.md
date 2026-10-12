# Pinned sample data

Hotel data is not redistributed. After `npm ci && npm run build`, explicitly run:

```sh
npm run data:fetch
npm run query-vector -- data/Hotels_Vector.json data/query-vector.json
```

`data:fetch` uses this fixed HTTPS URL, rejects redirects, limits size/time, verifies SHA-256 before creating a new file, and never replaces an existing file. Existing valid files are checked and reused; mismatch is an error. Query extraction validates the same pinned bytes and50×1536D shape and refuses to overwrite output. It needs no credentials/network/model. The query is the first hotel's stored vector, a **non-semantic self-match fixture**.

- Source: https://github.com/Azure-Samples/documentdb-samples/blob/f5a2675bbf349737234d0391e3ebee24b260e06f/ai/data/Hotels_Vector.json
- SHA-256: `60c08c2cdd439444ba8601d94a1f3487f4a9ee56cd48ba201d983c96722de6e4`
- Shape:50 hotels,1536-dimensional `DescriptionVector`, stable string `HotelId`.

The plain Hotels.json file is no longer needed because this sample does not generate embeddings. Regenerated/modified fixtures intentionally fail the pinned-hash gate; changing the dataset is a reviewed code change, not an unchecked override.

[Upstream data notes](https://github.com/Azure-Samples/documentdb-samples/blob/f5a2675bbf349737234d0391e3ebee24b260e06f/ai/data/README.md) and [license](https://github.com/Azure-Samples/documentdb-samples/blob/f5a2675bbf349737234d0391e3ebee24b260e06f/LICENSE.md) remain authoritative. These hashes identify inputs; they are not a separate dataset-rights grant. Retain applicable upstream notices when using the data.
