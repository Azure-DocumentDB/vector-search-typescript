import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import { MongoClient, type OIDCCallbackParams, type OIDCResponse } from 'mongodb';
import { type Config, requireValue, SampleError, loadConfig } from './config.js';
export const azureScope = 'https://ossrdbms-aad.database.windows.net/.default';
export async function tokenCallback(params: OIDCCallbackParams, credential: TokenCredential, caseSignal: AbortSignal, now = Date.now): Promise<OIDCResponse> {
  requireValue(params.version === 1, 'unsupported_oidc_callback_version');
  const signal = AbortSignal.any([params.timeoutContext, caseSignal]);
  signal.throwIfAborted();
  // Fixed audience, never trust a server-provided issuer/scope/tokenAudience.
  const token = await credential.getToken(azureScope, { abortSignal: signal });
  signal.throwIfAborted();
  requireValue(token && typeof token.token === 'string' && token.token.trim().length > 0 && Number.isFinite(token.expiresOnTimestamp), 'oidc_token_missing_or_invalid');
  const seconds = Math.floor((token.expiresOnTimestamp - now()) / 1000);
  requireValue(Number.isSafeInteger(seconds) && seconds > 0, 'oidc_token_expired');
  return { accessToken: token.token, expiresInSeconds: seconds };
}
export function makeClient(c: Config, signal: AbortSignal): MongoClient {
  // Defense in depth: even direct callers validate before constructing a credential.
  loadConfig({ MONGO_AUTH_MODE: c.authMode, MONGO_HOST: c.host, MONGO_CONNECTION_STRING: c.uri,
    MONGO_OIDC_USERNAME: c.username || undefined, MONGO_DATABASE: c.database, MONGO_COLLECTION_PREFIX: c.prefix,
    DATA_FILE_WITH_VECTORS: c.dataFile, QUERY_VECTOR_FILE: c.queryFile, VECTOR_SEARCH_ALLOW_WRITES: 'true' });
  signal.throwIfAborted();
  const common = { tls: true, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false,
    retryWrites: false, maxPoolSize: 2, minPoolSize: 0, serverSelectionTimeoutMS: Math.min(c.caseTimeoutMS, 15000),
    connectTimeoutMS: Math.min(c.caseTimeoutMS, 10000), socketTimeoutMS: Math.min(c.caseTimeoutMS, 30000),
    waitQueueTimeoutMS: Math.min(c.caseTimeoutMS, 10000), timeoutMS: c.caseTimeoutMS };
  if (c.authMode === 'connection-string') return new MongoClient(c.uri, common);
  if (c.authMode !== 'oidc') throw new SampleError('explicit_auth_mode_required');
  const credential = new DefaultAzureCredential({ processTimeoutInMs: Math.min(c.caseTimeoutMS, 10000) });
  return new MongoClient(`mongodb+srv://${c.host}/`, { ...common,
    authMechanism: 'MONGODB-OIDC', ...(c.username ? { auth: { username: c.username } } : {}),
    authMechanismProperties: { OIDC_CALLBACK: (params: OIDCCallbackParams) => tokenCallback(params, credential, signal) } });
}
