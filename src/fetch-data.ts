import { lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixtureURL, fixtureSHA256, loadFixture } from './data.js';
import { requireValue, safeError } from './config.js';
try {
  const [target = 'data/Hotels_Vector.json', extra] = process.argv.slice(2);
  requireValue(!extra, 'usage_fetch_data_optional_new_path');
  let exists = true;
  try { await lstat(target); } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') exists = false; else throw error; }
  if (exists) { await loadFixture(target); console.log(JSON.stringify({ status: 'existing_fixture_verified_no_overwrite' })); }
  else {
    const response = await fetch(fixtureURL, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    requireValue(response.ok && response.body, 'fixture_download_failed');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for await (const chunk of response.body) { size += chunk.length; requireValue(size <= 8_000_000, 'fixture_download_too_large'); chunks.push(chunk); }
    } finally { if (!response.body.locked) await response.body.cancel(); }
    const bytes = Buffer.concat(chunks);
    requireValue(createHash('sha256').update(bytes).digest('hex') === fixtureSHA256, 'fixture_checksum_mismatch');
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'pinned_fixture_downloaded', sha256: fixtureSHA256 }));
  }
} catch (error) { console.error(JSON.stringify({ status: 'failed', ...safeError(error) })); process.exitCode = 1; }
