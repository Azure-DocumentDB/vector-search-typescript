import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { requireValue, SampleError } from './config.js';
export const fixtureSHA256 = '60c08c2cdd439444ba8601d94a1f3487f4a9ee56cd48ba201d983c96722de6e4';
export const fixtureURL = 'https://raw.githubusercontent.com/Azure-Samples/documentdb-samples/f5a2675bbf349737234d0391e3ebee24b260e06f/ai/data/Hotels_Vector.json';
export interface Hotel { [key: string]: unknown; _id: string; HotelId: string; DescriptionVector: number[]; }
export function validateVector(value: unknown, dimensions: number): number[] {
  requireValue(Array.isArray(value) && value.length === dimensions, 'vector_dimensions_invalid');
  requireValue(value.every(n => typeof n === 'number' && Number.isFinite(n)), 'vector_values_invalid');
  const norm = value.reduce((s: number, n: number) => s + n * n, 0);
  requireValue(Number.isFinite(norm) && norm > 0, 'vector_norm_invalid');
  return value as number[];
}
function safeKeys(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      requireValue(key && !/[.$\0]/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key), 'unsafe_document_key');
      safeKeys(child);
    }
  }
}
export function prepareSeed(value: unknown, dimensions = 1536): Hotel[] {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= 1000, 'seed_array_required');
  const ids = new Set<string>();
  return value.map(row => {
    requireValue(row && typeof row === 'object' && !Array.isArray(row), 'seed_document_required');
    safeKeys(row);
    requireValue(typeof row.HotelId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(row.HotelId), 'stable_hotel_id_required');
    const id = row._id ?? 'vectorsearch:' + row.HotelId;
    requireValue(typeof id === 'string' && /^[A-Za-z0-9:_-]{1,120}$/.test(id) && !ids.has(id), 'unique_stable_id_required');
    ids.add(id);
    return { ...row, _id: id, DescriptionVector: validateVector(row.DescriptionVector, dimensions) } as Hotel;
  });
}
export async function readBounded(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    requireValue(stat.isFile() && stat.size <= maxBytes, 'input_size_or_type_invalid');
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    requireValue(offset <= maxBytes, 'input_size_or_type_invalid');
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}
export async function loadFixture(path: string): Promise<Hotel[]> {
  const raw = await readBounded(path, 8_000_000);
  requireValue(createHash('sha256').update(raw).digest('hex') === fixtureSHA256, 'fixture_checksum_mismatch');
  const docs = prepareSeed(JSON.parse(raw.toString('utf8')));
  requireValue(docs.length === 50, 'pinned_fixture_requires_50_hotels');
  return docs;
}
export async function loadQuery(path: string): Promise<number[]> {
  return validateVector(JSON.parse((await readBounded(path, 100_000)).toString('utf8')), 1536);
}
export async function writeNewJSON(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
}
export type Metric = 'COS' | 'L2' | 'IP';
export function oracle(docs: Hotel[], query: number[], metric: Metric, k: number): string[] {
  validateVector(query, query.length);
  requireValue(['COS', 'L2', 'IP'].includes(metric) && Number.isInteger(k) && k > 0 && k <= docs.length, 'oracle_input_invalid');
  // Independent scalar reference; never inspect or compare database scores.
  const magnitude = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  const ranked = docs.map(doc => {
    const vector = validateVector(doc.DescriptionVector, query.length);
    let dot = 0, squaredDistance = 0;
    for (let i = 0; i < query.length; i++) { dot += query[i]! * vector[i]!; squaredDistance += (query[i]! - vector[i]!) ** 2; }
    const value = metric === 'IP' ? dot : metric === 'COS' ? dot / (magnitude(query) * magnitude(vector)) : -squaredDistance;
    requireValue(Number.isFinite(value), 'oracle_nonfinite_metric');
    return { id: doc._id, value };
  }).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  // Exact order is a strict fixture gate, not a general approximate-search promise.
  for (let i = 1; i <= Math.min(k, ranked.length - 1); i++) {
    if (Math.abs(ranked[i - 1]!.value - ranked[i]!.value) < 1e-10) throw new SampleError('oracle_fixture_has_ambiguous_tie');
  }
  return ranked.slice(0, k).map(row => row.id);
}
