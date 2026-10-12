import { requireValue, safeError } from './config.js';
import { loadFixture, writeNewJSON } from './data.js';
try {
  const [input, output, extra] = process.argv.slice(2);
  requireValue(input && output && !extra, 'usage_query_vector_input_output');
  const docs = await loadFixture(input);
  await writeNewJSON(output, docs[0]!.DescriptionVector);
  console.log(JSON.stringify({ status: 'created', dimensions: 1536, mode: 'non_semantic_self_match_fixture_no_model' }));
} catch (error) { console.error(JSON.stringify({ status: 'failed', ...safeError(error) })); process.exitCode = 1; }
