import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { root, metadata } from '../lib/metadata.js';

const archive = join(root, 'dist', `ava-workbuddy-${metadata.version}.tgz`);
const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
assert(files.includes('package/lib/index.js') && files.includes('package/lib/index.d.ts'));
assert(files.includes('package/templates/artifact.html'));
assert(files.includes('package/npm-shrinkwrap.json'));
assert(!files.some((path) => /(?:CONTRIBUTING\.md|CHANGELOG\.md|docs\/publishing\.md)$/.test(path)));
assert(!files.some((path) => /(?:node_modules|\/test\/|\/scripts\/|\.env)/.test(path)));
const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-install-'));
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
try {
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund', archive], {
    cwd: directory, env, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024,
  });
  // This is a consumer project, so exports and declarations resolve through node_modules.
  await writeFile(join(directory, 'consumer.ts'), `
import { Runtime, checkEnvironment, type ArtifactInput, type QueryResult, type CleanupReport } from 'ava-workbuddy';
import { createServer } from 'ava-workbuddy/mcp';
const runtime = new Runtime();
const source = await runtime.source('/tmp/sales.csv');
const result: QueryResult = await runtime.query(source.datasetId, 'SELECT 1');
const rows: Record<string, unknown>[] = result.data;
const cleanup: CleanupReport = await runtime.close();
const report: ArtifactInput = { output: '/tmp/native.html', title: 'Native chart', summary: 'Query evidence',
  sections: [{ question: 'Distribution', conclusion: 'Verified', queryId: 'q_example',
    chart: { chartType: 'histogram', config: { binNumber: 10, theme: 'light' } }, chartConfigField: 'chart_config' }] };
const embedded = createServer();
await embedded.close();
console.log(rows, report, cleanup.retained, checkEnvironment().avaVersion);
// @ts-expect-error SQL must be a string, never arbitrary execution options.
runtime.query(source.datasetId, 123);
// @ts-expect-error Internal session ownership is not a mutable public field.
runtime.sessions.add('ds_other');
`);
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck',
    '--module', 'NodeNext', '--target', 'ES2022', '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), 'consumer.ts'], {
    cwd: directory, env, encoding: 'utf8', timeout: 30000,
  });
  const imported = execFileSync(process.execPath, ['--input-type=module', '-e', `
import { Runtime, checkEnvironment } from 'ava-workbuddy';
import { createServer } from 'ava-workbuddy/mcp';
const runtime = new Runtime();
const { datasetId } = await runtime.source(${JSON.stringify(join(directory, 'node_modules/ava-workbuddy/examples/sales.csv'))});
try {
  const result = await runtime.query(datasetId, 'SELECT SUM(revenue) AS total FROM data');
  if (Number(result.data[0].total) !== 67500 || result.truncated) throw new Error('Incorrect public API result');
} finally {
  const report = await runtime.close();
  if (report.retained.length) throw new Error('Leaked library session');
}
await createServer().close();
console.log(JSON.stringify(checkEnvironment()));
`], { cwd: directory, env, encoding: 'utf8', timeout: 120000 });
  assert.equal(JSON.parse(imported).avaVersion, '4.0.0');
  const output = execFileSync(process.execPath, [join(directory, 'node_modules/ava-workbuddy/lib/cli.js'), 'smoke'], {
    cwd: directory, env, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024,
  });
  const result = JSON.parse(output);
  assert.equal(result.computationVerified, true);
  assert.equal(result.htmlGenerated, true);
  const sums = await readFile(join(root, 'dist/SHA256SUMS'), 'utf8');
  assert(sums.includes(`ava-workbuddy-${metadata.version}.tgz`));
  console.log(JSON.stringify({ package: archive, freshDirectory: true, publicApiVerified: true, typesVerified: true, ...result }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
