import { loadConfig, requireValue, safeError } from './config.js';
import { comparison } from './mode.js';
import { cases, type Algorithm } from './store.js';
import { loadInputs, runCases } from './run.js';
export async function main(args = process.argv.slice(2), env = process.env): Promise<void> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const live = args.includes('--live');
    requireValue(!live || env.LIVE_AZURE_TEST === 'true', 'live_gate_requires_LIVE_AZURE_TEST_true_no_network');
    const filtered = args.filter(arg => arg !== '--live');
    let algorithm: Algorithm | undefined;
    if (filtered.length) {
      requireValue(!comparison && filtered.length === 2 && filtered[0] === '--algorithm' && ['ivf', 'hnsw', 'diskann'].includes(filtered[1]!), 'invalid_cli_arguments');
      algorithm = filtered[1] as Algorithm;
    }
    const config = loadConfig(env), planned = cases(comparison, algorithm);
    // A final process-level cap also contains an SDK/transport that ignores cancellation.
    // Each case first gets its own deadline and a bounded close attempt.
    watchdog = setTimeout(() => {
      console.error(JSON.stringify({ status: 'failed', error: 'process_deadline_exceeded_transport_did_not_close' })); process.exit(1);
    }, planned.length * (config.caseTimeoutMS + 5000) + 10000);
    watchdog.unref();
    const inputs = await loadInputs(config, planned);
    const report = await runCases(config, planned, inputs);
    console.log(JSON.stringify(report));
    if (report.failed) process.exitCode = 1;
    // Keep the unref'd watchdog until process exit: any leaked SDK handle gets bounded.
  } catch (error) {
    if (watchdog) clearTimeout(watchdog);
    console.error(JSON.stringify({ status: 'failed', ...safeError(error) })); process.exitCode = 1;
  }
}
await main();
