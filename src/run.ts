import { type Config, requireValue, safeError, SampleError } from './config.js';
import { type Hotel, type Metric, loadFixture, loadQuery, oracle } from './data.js';
import { type Case, type Store, type Hit, type SeedStats, collectionName, indexSpec, compatibleIndex, MongoStore } from './store.js';
import { makeClient } from './auth.js';
export interface CaseResult extends Case {
  collection: string; status: 'passed' | 'failed'; quality: string; seed?: SeedStats; hits?: Hit[];
  expectedIds: string[]; error?: string; serverCode?: number; cleanupError?: string;
}
export interface Report { database: string; authMode: string; mode: string; cases: CaseResult[]; succeeded: number; failed: number; }
export interface Inputs { docs: Hotel[]; query: number[]; expected: Map<Metric, string[]>; }
export async function loadInputs(c: Config, planned: Case[]): Promise<Inputs> {
  const docs = await loadFixture(c.dataFile), query = await loadQuery(c.queryFile);
  const expected = new Map<Metric, string[]>();
  for (const item of planned) expected.set(item.metric, oracle(docs, query, item.metric, c.topK));
  return { docs, query, expected };
}
export async function within<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const timeout = new Promise<never>((_, reject) => { abort = () => reject(new SampleError('case_deadline_exceeded')); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([operation, timeout]); } finally { signal.removeEventListener('abort', abort); }
}
export async function closeBounded(store: Store, milliseconds = 5000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([store.close(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SampleError('cleanup_deadline_exceeded')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
export type StoreFactory = (c: Config, item: Case, signal: AbortSignal) => Store;
export const productionFactory: StoreFactory = (c, item, signal) => new MongoStore(makeClient(c, signal), c, item, signal);
export async function runCases(c: Config, planned: Case[], inputs: Inputs, factory: StoreFactory = productionFactory): Promise<Report> {
  const report: Report = { database: c.database, authMode: c.authMode, mode: 'precomputed-real-database-no-model', cases: [], succeeded: 0, failed: 0 };
  for (const item of planned) {
    const expectedIds = inputs.expected.get(item.metric)!;
    const row: CaseResult = { ...item, collection: collectionName(c, item), status: 'failed', quality: 'not_verified', expectedIds };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), c.caseTimeoutMS);
    let store: Store | undefined;
    try {
      store = factory(c, item, controller.signal);
      const scoped = store;
      await within((async () => {
        await scoped.connect();
        const spec = indexSpec(item);
        if (!compatibleIndex(await scoped.indexes(), spec)) {
          await scoped.createIndex(spec);
          requireValue(compatibleIndex(await scoped.indexes(), spec), 'index_not_visible_after_create');
        }
        row.seed = await scoped.seed(inputs.docs, c.batchSize);
        row.hits = await scoped.search(inputs.query, c.topK);
        requireValue(row.hits.length === expectedIds.length && row.hits.every((hit, i) => hit.id === expectedIds[i]), 'independent_metric_rank_oracle_mismatch');
        row.quality = 'exact_fixture_top_k_rank_match';
      })(), controller.signal);
      row.status = 'passed';
    } catch (error) { Object.assign(row, safeError(error)); }
    finally {
      clearTimeout(timer); controller.abort();
      if (store) try { await closeBounded(store); } catch (error) { row.cleanupError = safeError(error).error; row.status = 'failed'; }
    }
    report.cases.push(row);
    if (row.status === 'passed') report.succeeded++; else report.failed++;
  }
  return report;
}
