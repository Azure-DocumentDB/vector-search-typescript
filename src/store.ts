import { type Collection, type Db, type Document, type MongoClient } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import { type Config, requireValue } from './config.js';
import { type Hotel, type Metric } from './data.js';
export type Algorithm = 'ivf' | 'hnsw' | 'diskann';
export interface Case { algorithm: Algorithm; metric: Metric; }
export function cases(comparison: boolean, algorithm?: Algorithm): Case[] {
  return (algorithm ? [algorithm] : ['ivf', 'hnsw', 'diskann'] as Algorithm[]).flatMap(a =>
    (comparison ? ['COS', 'L2', 'IP'] as Metric[] : ['COS'] as Metric[]).map(metric => ({ algorithm: a, metric })));
}
export function collectionName(c: Config, item: Case): string { return `${c.prefix}_${item.algorithm}_${item.metric.toLowerCase()}`; }
export function indexSpec(item: Case): Document {
  const options = item.algorithm === 'ivf' ? { numLists: 1 } : item.algorithm === 'hnsw' ? { m: 16, efConstruction: 64 } : { maxDegree: 20, lBuild: 50 };
  return { name: `sample_${item.algorithm}_${item.metric.toLowerCase()}`, key: { DescriptionVector: 'cosmosSearch' },
    cosmosSearchOptions: { kind: `vector-${item.algorithm}`, similarity: item.metric, dimensions: 1536, ...options } };
}
export function compatibleIndex(indexes: Document[], spec: Document): boolean {
  let found = false;
  for (const index of indexes) {
    const relevant = index.name === spec.name || index.key?.DescriptionVector === 'cosmosSearch' ||
      (index.key && 'DescriptionVector' in index.key && index.cosmosSearchOptions);
    if (!relevant) continue;
    requireValue(isDeepStrictEqual(index.key, spec.key) && isDeepStrictEqual(index.cosmosSearchOptions, spec.cosmosSearchOptions), 'index_definition_conflict_use_new_collection');
    for (const [key, value] of Object.entries(index)) {
      if (['name', 'key', 'cosmosSearchOptions', 'v', 'ns', 'background'].includes(key)) continue;
      requireValue(['sparse', 'unique', 'hidden'].includes(key) && value === false, 'index_catalog_semantics_conflict_use_new_collection');
    }
    requireValue(!found, 'multiple_vector_indexes_conflict'); found = true;
  }
  return found;
}
export interface SeedStats { total: number; inserted: number; existing: number; }
export interface Hit { id: string; score: number; }
export interface Store {
  connect(): Promise<void>; indexes(): Promise<Document[]>; createIndex(spec: Document): Promise<void>;
  seed(docs: Hotel[], batchSize: number): Promise<SeedStats>; search(query: number[], k: number): Promise<Hit[]>;
  close(): Promise<void>;
}
export async function seedData(collection: Pick<Collection<Hotel>, 'bulkWrite'>, docs: Hotel[], batchSize: number, timeoutMS: () => number): Promise<SeedStats> {
  requireValue(Number.isInteger(batchSize) && batchSize > 0 && batchSize <= 1000 && docs.length > 0, 'invalid_seed_batch');
  const stats = { total: docs.length, inserted: 0, existing: 0 };
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const result = await collection.bulkWrite(batch.map(doc => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } })), { ordered: true, timeoutMS: timeoutMS() });
    requireValue(result.isOk() && result.upsertedCount + result.matchedCount === batch.length && result.modifiedCount === 0, 'seed_write_not_fully_acknowledged');
    stats.inserted += result.upsertedCount; stats.existing += result.matchedCount;
  }
  return stats;
}
export function parseHits(rows: Document[], k: number): Hit[] {
  requireValue(rows.length > 0 && rows.length <= k, 'empty_or_excess_search_results');
  const seen = new Set<string>();
  return rows.map(row => {
    requireValue(typeof row.document?._id === 'string' && /^[A-Za-z0-9:_-]{1,120}$/.test(row.document._id), 'invalid_result_id');
    requireValue(typeof row.score === 'number' && Number.isFinite(row.score), 'invalid_result_score');
    requireValue(!seen.has(row.document._id), 'duplicate_result_id'); seen.add(row.document._id);
    return { id: row.document._id as string, score: row.score as number };
  });
}
export class MongoStore implements Store {
  private readonly db: Db;
  private readonly collection: Collection<Hotel>;
  private readonly deadline: number;
  constructor(private readonly client: MongoClient, c: Config, item: Case, private readonly signal: AbortSignal) {
    this.db = client.db(c.database); this.collection = this.db.collection<Hotel>(collectionName(c, item));
    this.deadline = Date.now() + c.caseTimeoutMS;
  }
  private remaining = (): number => { this.signal.throwIfAborted(); const ms = this.deadline - Date.now(); requireValue(ms > 0, 'case_deadline_exceeded'); return ms; };
  async connect(): Promise<void> { this.remaining(); await this.client.connect(); await this.db.command({ ping: 1 }, { timeoutMS: this.remaining(), signal: this.signal }); }
  async indexes(): Promise<Document[]> {
    const cursor = this.collection.listIndexes({ timeoutMS: this.remaining() });
    try { return await cursor.toArray(); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 26) return []; throw error; }
    finally { await cursor.close({ timeoutMS: 5000 }); }
  }
  async createIndex(spec: Document): Promise<void> { await this.db.command({ createIndexes: this.collection.collectionName, indexes: [spec] }, { timeoutMS: this.remaining(), signal: this.signal }); }
  async seed(docs: Hotel[], batchSize: number): Promise<SeedStats> { return seedData(this.collection, docs, batchSize, this.remaining); }
  async search(query: number[], k: number): Promise<Hit[]> {
    const cursor = this.collection.aggregate([
      { $search: { cosmosSearch: { vector: query, path: 'DescriptionVector', k }, returnStoredSource: true } },
      { $project: { score: { $meta: 'searchScore' }, document: '$$ROOT' } }
    ], { timeoutMS: this.remaining(), signal: this.signal });
    try { return parseHits(await cursor.toArray(), k); } finally { await cursor.close({ timeoutMS: 5000 }); }
  }
  async close(): Promise<void> { await this.client.close(); }
}
