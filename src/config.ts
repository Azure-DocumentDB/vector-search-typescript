export class SampleError extends Error {
  constructor(public readonly reason: string) { super(reason); this.name = 'SampleError'; }
}
export function requireValue(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new SampleError(reason);
}
export interface Config {
  authMode: 'oidc' | 'connection-string'; host: string; uri: string; username: string;
  database: string; prefix: string; dataFile: string; queryFile: string;
  dimensions: number; batchSize: number; topK: number; caseTimeoutMS: number;
}
const azureHost = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:global\.)?mongocluster\.cosmos\.azure\.com$/;
export function validateURI(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SampleError('invalid_connection_uri'); }
  requireValue(u.protocol === 'mongodb+srv:' && azureHost.test(u.hostname) && !u.port && !u.hash && !raw.includes('#') && (u.pathname === '' || u.pathname === '/'), 'invalid_connection_endpoint');
  requireValue(u.username && u.password, 'native_credentials_required');
  try { requireValue(decodeURIComponent(u.username).trim() && decodeURIComponent(u.password).trim(), 'native_credentials_required'); } catch { throw new SampleError('invalid_native_credentials'); }
  const seen = new Set<string>();
  for (const [key, value] of u.searchParams) {
    const k = key.toLowerCase(), v = value.toLowerCase();
    requireValue(!seen.has(k), 'duplicate_uri_option'); seen.add(k);
    // Deliberate allowlist: URI cannot override transport, OIDC or time bounds.
    const allowed = (['tls', 'ssl'].includes(k) && v === 'true') ||
      (['retrywrites', 'tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames'].includes(k) && v === 'false') ||
      (k === 'authmechanism' && ['SCRAM-SHA-256', 'SCRAM-SHA-1'].includes(value)) ||
      (k === 'authsource' && value === 'admin') ||
      (k === 'appname' && /^[A-Za-z0-9_-]{1,80}$/.test(value));
    requireValue(allowed, 'unsupported_or_unsafe_uri_option');
  }
  return u.hostname;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  requireValue(env.VECTOR_SEARCH_ALLOW_WRITES === 'true', 'writes_require_explicit_opt_in');
  requireValue(env.EMBEDDING_MODE === undefined || env.EMBEDDING_MODE === 'offline', 'only_precomputed_vectors_supported');
  requireValue(env.MONGO_COLLECTION === undefined, 'use_collection_prefix_not_override');
  const number = (key: string, fallback: number, max: number, min = 1): number => {
    const raw = env[key] ?? String(fallback);
    requireValue(/^\d+$/.test(raw), 'invalid_' + key.toLowerCase());
    const n = Number(raw); requireValue(Number.isSafeInteger(n) && n >= min && n <= max, 'invalid_' + key.toLowerCase()); return n;
  };
  for (const [key, expected] of [['EMBEDDED_FIELD', 'DescriptionVector'], ['SEED_ID_FIELD', 'HotelId']] as const) {
    requireValue(env[key] === undefined || env[key] === expected, 'unsupported_' + key.toLowerCase());
  }
  const authMode = env.MONGO_AUTH_MODE;
  requireValue(authMode === 'oidc' || authMode === 'connection-string', 'explicit_auth_mode_required');
  const database = env.MONGO_DATABASE ?? '';
  requireValue(/^vectorsearch_disposable_[a-z0-9][a-z0-9_]*$/.test(database) && database.length <= 63, 'unique_disposable_database_required');
  const prefix = env.MONGO_COLLECTION_PREFIX ?? '';
  requireValue(/^[a-z][a-z0-9_]{0,39}$/.test(prefix), 'explicit_collection_prefix_required');
  const uri = env.MONGO_CONNECTION_STRING ?? '';
  let host = env.MONGO_HOST ?? (env.MONGO_CLUSTER_NAME ? env.MONGO_CLUSTER_NAME + '.global.mongocluster.cosmos.azure.com' : '');
  if (authMode === 'oidc') {
    requireValue(!uri, 'oidc_connection_string_must_be_unset');
    requireValue(azureHost.test(host), 'invalid_oidc_endpoint');
  } else {
    host = validateURI(uri);
    requireValue(!env.MONGO_OIDC_USERNAME, 'no_oidc_credentials_in_native_mode');
  }
  const username = env.MONGO_OIDC_USERNAME ?? '';
  requireValue(username.length <= 256 && !/[\s<>]/.test(username), 'invalid_oidc_username');
  const dataFile = env.DATA_FILE_WITH_VECTORS ?? 'data/Hotels_Vector.json';
  const queryFile = env.QUERY_VECTOR_FILE ?? '';
  requireValue(queryFile && dataFile, 'precomputed_query_file_required');
  const dimensions = number('EMBEDDING_DIMENSIONS', 1536, 1536);
  requireValue(dimensions === 1536, 'pinned_fixture_requires_1536_dimensions');
  return { authMode, host, uri, username, database, prefix, dataFile, queryFile, dimensions,
    batchSize: number('LOAD_SIZE_BATCH', 50, 1000), topK: number('TOP_K', 5, 50),
    caseTimeoutMS: number('VECTOR_SEARCH_CASE_TIMEOUT_MS', 120000, 300000, 1000) };
}
export function safeError(error: unknown): { error: string; serverCode?: number } {
  if (error instanceof SampleError) return { error: error.reason };
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return { error: 'operation_failed_details_withheld', ...(typeof code === 'number' && Number.isSafeInteger(code) ? { serverCode: code } : {}) };
}
