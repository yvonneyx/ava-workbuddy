import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AVACommandError, checkEnvironment, Runtime } from '../lib/index.js';
import { outputPath, sourcePath } from '../lib/ava.js';
import { root } from '../lib/metadata.js';
import { validate } from '../scripts/validate.mjs';
import { createServer } from '../lib/server.js';
import { runInNewContext } from 'node:vm';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

const id = 'ds_test_012345abcdef';
const file = join(root, 'examples/sales.csv');
const rows = { schema: [{ name: 'value' }], data: [{ value: 1 }], rowCount: 1 };
class StubRuntime extends Runtime {
  calls = [];
  command = async ([name]) => name === 'source' ? { datasetId: id } : { datasetId: id, disposed: true };
  invoke(args, input) { this.calls.push({ args, input }); return this.command(args, input); }
}

async function loaded() {
  const runtime = new StubRuntime();
  await runtime.source(file);
  runtime.calls = [];
  return runtime;
}

test('reject unsupported runtimes and platforms before creating sessions', () => {
  for (const version of ['20.19.5', '22.0.0', '22.12.0', 'invalid']) assert.throws(() => checkEnvironment(version, 'linux'), /22.13/);
  assert.throws(() => checkEnvironment('22.22.0', 'win32'), /Windows/);
  assert.equal(checkEnvironment('22.13.0', 'linux').ready, true);
  assert.equal(checkEnvironment('24.0.0', 'darwin').ready, true);
});

test('accept only absolute local file inputs and HTML destinations', async () => {
  await assert.rejects(sourcePath('sales.csv'), /absolute/);
  await assert.rejects(sourcePath('https://example.com/sales.csv'), /absolute/);
  await assert.rejects(sourcePath('/tmp/credentials.txt'), /CSV and XLSX/);
  assert.throws(() => outputPath('chart.html'), /absolute/);
  assert.throws(() => outputPath('/tmp/file.js'), /\.html/);
  const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-unit-'));
  try {
    const path = join(directory, '销售 数据.csv'); await writeFile(path, 'x\n1');
    assert.match(await sourcePath(path), /销售 数据.csv$/);
    const target = join(directory, 'other.json'); await writeFile(target, '{}');
    const alias = join(directory, 'alias.csv'); await symlink(target, alias);
    await assert.rejects(sourcePath(alias), /resolved source/);
    const folder = join(directory, 'directory.csv'); await mkdir(folder);
    await assert.rejects(sourcePath(folder), /regular file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('reject datasets created by another connection without running AVA', async () => {
  const runtime = new StubRuntime();
  await assert.rejects(runtime.schema('ds_other_012345abcdef'), /not owned/);
  assert.equal(runtime.calls.length, 0);
});

test('prevent concurrent commands and preserve SQL as stdin rather than shell input', async () => {
  const runtime = await loaded();
  let release;
  runtime.command = () => new Promise((resolve) => { release = resolve; });
  const sql = "SELECT '$(literal)' AS value";
  const first = runtime.query(id, sql, 10);
  await assert.rejects(runtime.query(id, 'SELECT 2'), /already running/);
  release(rows); const result = await first;
  assert.match(result.queryId, /^q_/);
  const { queryId, ...data } = result; assert.deepEqual(data, rows);
  assert.deepEqual(runtime.calls, [{ args: ['query', id, '--dsl', '-', '--max-rows', '10'], input: sql }]);
});

test('validate SQL byte limits and row limits before invoking AVA', async () => {
  const runtime = await loaded();
  for (const sql of ['', '  ', '中'.repeat(180000)]) await assert.rejects(runtime.query(id, sql), /512 KiB/);
  for (const limit of [0, 10001, 1.1, NaN]) await assert.rejects(runtime.query(id, 'SELECT 1', limit), /maxRows/);
  assert.equal(runtime.calls.length, 0);
});

test('do not retry or dispose uncertain sessions; report retention to the caller', async () => {
  const runtime = await loaded();
  runtime.command = async () => { throw new AVACommandError('timed out', true); };
  await assert.rejects(runtime.query(id, 'SELECT 3'), /timed out/);
  await assert.rejects(runtime.query(id, 'SELECT 3'), /uncertain/);
  await assert.rejects(runtime.dispose(id), /uncertain/);
  assert.deepEqual(await runtime.close(), { disposed: [], retained: [id], errors: [] });
  assert.equal(runtime.calls.length, 1);
});

test('unexpected subprocess responses also block unsafe session reuse', async () => {
  const runtime = await loaded();
  runtime.command = async () => ({ data: 'invalid' });
  await assert.rejects(runtime.query(id, 'SELECT 1'), /unexpected response/);
  await assert.rejects(runtime.dispose(id), /uncertain/);
  assert.deepEqual((await runtime.close()).retained, [id]);
});

test('close drains a source that has not yet finished file validation', async () => {
  const runtime = new StubRuntime();
  const source = runtime.source(file);
  const close = runtime.close();
  await assert.rejects(runtime.source(file), /shutting down/);
  await assert.rejects(runtime.viz({ chartType: 'bar', config: {} }, '/tmp/unused.html'), /shutting down/);
  assert.deepEqual(await source, { datasetId: id });
  assert.deepEqual(await close, { disposed: [id], retained: [], errors: [] });
  assert.deepEqual(runtime.calls.map(({ args }) => args[0]), ['source', 'dispose']);
});

test('cleanup is idempotent and reports failures without claiming disposal', async () => {
  const runtime = await loaded();
  runtime.command = async () => { throw new Error('socket unavailable'); };
  const close = runtime.close();
  assert.equal(runtime.close(), close);
  assert.deepEqual(await close, { disposed: [], retained: [id], errors: [{ datasetId: id, message: 'socket unavailable' }] });
  assert.equal(runtime.calls.length, 1);
});

test('embedded MCP close waits for an accepted tool before cleaning up its session', async () => {
  const runtime = new StubRuntime();
  let release;
  let started;
  const accepted = new Promise((resolve) => { started = resolve; });
  runtime.command = (args) => {
    if (args[0] !== 'source') return Promise.resolve({ datasetId: id, disposed: true });
    started();
    return new Promise((resolve) => { release = resolve; });
  };
  const connection = createServer(runtime);
  const client = new Client({ name: 'lifecycle-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([connection.server.connect(serverTransport), client.connect(clientTransport)]);
  const response = client.callTool({ name: 'ava_source', arguments: { path: file } }).catch((error) => error);
  await accepted;
  let finished = false;
  const closing = connection.close().then((report) => { finished = true; return report; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  release({ datasetId: id });
  assert.deepEqual(await closing, { disposed: [id], retained: [], errors: [] });
  await response;
  await client.close();
});

test('semantic replacement writes private JSON, then removes it on failure', async () => {
  const runtime = await loaded();
  let path;
  runtime.command = async (args) => {
    const { readFile, stat } = await import('node:fs/promises');
    path = args[3];
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { description: 'Revenue in USD' });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    throw new Error('replacement failed');
  };
  await assert.rejects(runtime.semantic(id, { description: 'Revenue in USD' }), /replacement failed/);
  await assert.rejects((await import('node:fs/promises')).access(path));
});

test('public library imports have no CLI side effects; help and errors use the correct streams', () => {
  const options = { cwd: root, encoding: 'utf8' };
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', "await import('ava-workbuddy'); await import('ava-workbuddy/mcp');"], options), '');
  assert.match(execFileSync(process.execPath, ['lib/cli.js', '--help'], options), /ava-workbuddy/);
  assert.throws(() => execFileSync(process.execPath, ['lib/cli.js', 'invalid'], { ...options, stdio: 'pipe' }), (error) => {
    assert.equal(error.status, 1); assert.equal(error.stdout, ''); assert.match(error.stderr, /Unknown command/); return true;
  });
});

test('WorkBuddy packages reference complete, version-consistent resources', async () => {
  assert.equal((await validate()).valid, true);
});

test('artifact uses immutable executed evidence after disposal and escapes untrusted content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-artifact-'));
  const runtime = await loaded();
  try {
    runtime.command = async (args) => args[0] === 'query' ? { schema: [{ name: 'value' }], data: [{ value: '</script><img src=x onerror=alert(1)>' }] }
      : { datasetId: id, disposed: true };
    const sql = "SELECT '</script><img src=x onerror=alert(1)>' AS value";
    const result = await runtime.query(id, sql);
    result.data[0].value = 'caller mutation';
    await runtime.dispose(id);
    const output = join(directory, 'artifact.html');
    const artifact = await runtime.artifact({ output, title: '<img src=x onerror=alert(2)>', summary: 'A & B',
      sections: [{ question: 'Original question', conclusion: '<script>alert(3)</script>', queryId: result.queryId }] });
    const html = await readFile(output, 'utf8');
    assert(!html.includes('<img src=x')); assert(!html.includes('<script>alert(3)'));
    assert(html.includes('\\u003cimg src=x')); assert(!html.includes('caller mutation'));
    const payload = JSON.parse(html.match(/<script id="artifact-data" type="application\/json">(.*?)<\/script>/s)[1]);
    assert.deepEqual(JSON.parse(await readFile(artifact.dataOutput, 'utf8')), payload);
    assert.equal(payload.queries[0].sql, sql);
    assert.equal(payload.queries[0].result.data[0].value, '</script><img src=x onerror=alert(1)>');
    assert.equal(payload.queries[0].source, 'sales.csv');
    assert(!html.includes(root), 'Report must not leak the absolute source path');
    await assert.rejects(runtime.artifact({ output, title: 'Other', summary: 'Other', sections: [{ question: 'Q', conclusion: 'C', queryId: result.queryId }] }), /EEXIST/);
    assert.equal(await readFile(output, 'utf8'), html);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('artifact preserves existing JSON and rolls back new HTML on collision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-artifact-collision-'));
  const runtime = await loaded();
  try {
    runtime.command = async () => rows;
    const result = await runtime.query(id, 'SELECT 1 AS value');
    const output = join(directory, 'artifact.html');
    const dataOutput = join(directory, 'artifact.json');
    await writeFile(dataOutput, 'existing evidence');
    await assert.rejects(runtime.artifact({ output, title: 'Report', summary: 'Summary',
      sections: [{ question: 'Q', conclusion: 'C', queryId: result.queryId }] }), /EEXIST/);
    assert.equal(await readFile(dataOutput, 'utf8'), 'existing evidence');
    await assert.rejects(readFile(output), /ENOENT/);
  } finally { runtime.command = async () => ({ datasetId: id, disposed: true }); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('artifact rejects unknown evidence and invalid metrics instead of inventing results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-artifact-'));
  const runtime = await loaded();
  try {
    runtime.command = async () => rows;
    const result = await runtime.query(id, 'SELECT 1 AS value');
    const base = { output: join(directory, 'artifact.html'), title: 'Report', summary: 'Summary', sections: [{ question: 'Q', conclusion: 'C', queryId: result.queryId }] };
    await assert.rejects(runtime.artifact({ ...base, sections: [{ ...base.sections[0], queryId: 'invented' }] }), /Unknown or expired queryId/);
    await assert.rejects(runtime.artifact({ ...base, metrics: [{ label: 'Value', queryId: result.queryId, field: 'missing' }] }), /Unknown result field/);
    await assert.rejects(runtime.artifact({ ...base, metrics: [{ label: 'Value', queryId: result.queryId, field: 'value', rowIndex: 99 }] }), /outside query result/);
    for (let i = 0; i < 32; i++) await runtime.query(id, 'SELECT 1 AS value');
    await assert.rejects(runtime.artifact(base), /Unknown or expired queryId/);
  } finally { runtime.command = async () => ({ datasetId: id, disposed: true }); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('artifact passes native AVA options and saved rows, retaining evidence on chart failure or truncation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-artifact-'));
  const runtime = await loaded();
  const chart = { chartType: 'pie', config: { title: 'Share', innerRadius: 0.6, theme: 'academy', style: { palette: ['#222222', '#999999'] } } };
  try {
    runtime.command = async (args, input) => {
      if (args[0] === 'query') return { schema: [{ name: 'category' }, { name: 'value' }], data: [{ category: 'A', value: 7 }] };
      if (args[0] === 'viz') {
        assert.deepEqual(JSON.parse(input), { chartType: 'pie', config: { ...chart.config, data: [{ category: 'A', value: 7 }] } });
        const output = args.at(-1); await writeFile(output, '<html><body>chart</body></html>'); return { output };
      }
      return { datasetId: id, disposed: true };
    };
    const result = await runtime.query(id, 'SELECT label AS category, value FROM data');
    result.data[0].value = 999;
    const base = { title: 'Report', summary: 'Summary', sections: [{ question: 'Q', conclusion: 'C', queryId: result.queryId, chart }] };
    const output = join(directory, 'chart.html');
    assert.deepEqual((await runtime.artifact({ ...base, output })).chartErrors, []);
    const html = await readFile(output, 'utf8');
    assert(html.includes('sandbox="allow-scripts"')); assert(html.includes('\\u003chtml>')); assert(!html.includes('allow-same-origin'));
    runtime.command = async ([name]) => { if (name === 'viz') throw new Error('renderer failed'); return { datasetId: id, disposed: true }; };
    const failed = await runtime.artifact({ ...base, output: join(directory, 'failed.html') });
    assert.deepEqual(failed.chartErrors, [{ section: 1, message: 'renderer failed' }]);
    assert((await readFile(failed.output, 'utf8')).includes('<table>'));
    runtime.command = async () => ({ schema: [{ name: 'category' }, { name: 'value' }], data: [{ category: 'A', value: 7 }], truncated: true });
    const truncated = await runtime.query(id, 'SELECT label, value FROM data', 1);
    const limited = await runtime.artifact({ ...base, output: join(directory, 'limited.html'), sections: [{ ...base.sections[0], queryId: truncated.queryId }] });
    assert.match(limited.chartErrors[0].message, /截断/);
    assert((await readFile(limited.output, 'utf8')).includes('本报告包含截断'));
  } finally { runtime.command = async () => ({ datasetId: id, disposed: true }); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('artifact binds native histogram, dual-axis and liquid configs from one query cell', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-native-config-'));
  const runtime = await loaded();
  try {
    for (const [chartType, bound] of [
      ['histogram', { data: [10, 20, 30] }],
      ['dual-axes', { categories: ['Jan', 'Feb'], series: [{ type: 'column', data: [10, 20] }, { type: 'line', data: [1, 2] }] }],
      ['liquid', { percent: 0.25 }],
    ]) {
      const chart = { chartType, config: { title: 'Native config', theme: 'dark' } };
      runtime.command = async (args, input) => {
        if (args[0] === 'query') return { schema: [{ name: 'chart_config' }], data: [{ chart_config: bound }] };
        if (args[0] === 'viz') {
          assert.deepEqual(JSON.parse(input), { chartType, config: { ...chart.config, ...bound } });
          const output = args.at(-1); await writeFile(output, '<html>chart</html>'); return { output };
        }
        return { datasetId: id, disposed: true };
      };
      const result = await runtime.query(id, 'SELECT native_config AS chart_config');
      result.data[0].chart_config = { data: ['changed after query'] };
      const report = await runtime.artifact({ output: join(directory, `${chartType}.html`), title: 'Native chart', summary: 'Verified data',
        sections: [{ question: 'Q', conclusion: 'C', queryId: result.queryId, chart, chartConfigField: 'chart_config' }] });
      assert.deepEqual(report.chartErrors, []);
    }
  } finally { runtime.command = async () => ({ datasetId: id, disposed: true }); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('artifact refuses inline chart data and ambiguous config evidence without calling AVA', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-chart-evidence-'));
  const runtime = await loaded();
  let files = 0;
  const report = async (queryId, chart, chartConfigField) => runtime.artifact({ output: join(directory, `${files++}.html`), title: 'Evidence', summary: 'Summary',
    sections: [{ question: 'Q', conclusion: 'C', queryId, chart, ...(chartConfigField === undefined ? {} : { chartConfigField }) }] });
  try {
    runtime.command = async () => rows;
    const result = await runtime.query(id, 'SELECT 1 AS value');
    for (const key of ['data', 'categories', 'series', 'percent']) {
      const rejected = await report(result.queryId, { chartType: 'pie', config: { [key]: 'invented' } });
      assert.match(rejected.chartErrors[0].message, /must come from query evidence/);
    }
    const missing = await report(result.queryId, { chartType: 'histogram', config: {} }, 'missing');
    assert.match(missing.chartErrors[0].message, /Unknown result field/);
    runtime.command = async () => ({ schema: [{ name: 'chart_config' }], data: [{ chart_config: {} }, { chart_config: {} }] });
    const multiple = await runtime.query(id, 'SELECT config AS chart_config');
    assert.match((await report(multiple.queryId, { chartType: 'histogram', config: {} }, 'chart_config')).chartErrors[0].message, /single-row/);
    runtime.command = async () => ({ schema: [{ name: 'chart_config' }], data: [{ chart_config: 'not an object' }] });
    const invalid = await runtime.query(id, 'SELECT config AS chart_config');
    assert.equal((await report(invalid.queryId, { chartType: 'histogram', config: {} }, 'chart_config')).chartErrors.length, 1);
    assert(!runtime.calls.some(({ args }) => args[0] === 'viz'));
  } finally { runtime.command = async () => ({ datasetId: id, disposed: true }); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('different report fields use byte-identical templates with a single JSON data slot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-template-'));
  const runtime = await loaded();
  try {
    runtime.command = async () => rows;
    const result = await runtime.query(id, 'SELECT 1 AS value');
    const fields = { title: 'Report A', summary: 'First question', sections: [{ question: 'Question A', conclusion: 'Conclusion A', queryId: result.queryId }] };
    const first = await runtime.artifact({ ...fields, output: join(directory, 'first.html') });
    const second = await runtime.artifact({ ...fields, title: 'Report B', summary: 'Different summary', sections: [fields.sections[0], { question: 'Question B', conclusion: 'Conclusion B', queryId: result.queryId }], output: join(directory, 'second.html') });
    const template = await readFile(join(root, 'templates/artifact.html'), 'utf8');
    for (const artifact of [first, second]) {
      const html = await readFile(artifact.output, 'utf8');
      assert.equal(html.replace(/<script id="artifact-data" type="application\/json">.*?<\/script>/s, '<!-- ARTIFACT_DATA -->'), template);
    }
    assert(!template.includes('Report A') && !template.includes('Question B'));
    const reportStyles = template.match(/<style>(.*?)<\/style>/s)[1].replace(/\.sql-token-[\w-]+\s*\{[^}]*\}/g, '');
    for (const [, hex] of reportStyles.matchAll(/#([a-f0-9]{6})\b/gi)) assert(hex.slice(0, 2) === hex.slice(2, 4) && hex.slice(2, 4) === hex.slice(4, 6), `Not grayscale: ${hex}`);
  } finally { runtime.command = async () => ({ datasetId: id, disposed: true }); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('SQL highlighting preserves exact text and distinguishes literals, comments and keywords', async () => {
  const template = await readFile(join(root, 'templates/artifact.html'), 'utf8');
  const start = template.indexOf('function sqlTokens(sql)');
  const end = template.indexOf('function highlightSQL(', start);
  const tokenize = runInNewContext(template.slice(start, end) + '; sqlTokens');
  const sql = `-- SELECT is a comment\r\nSELECT SUM(value), 'it''s </script><img src=x onerror=alert(1)>' AS "FROM", $$WHERE$$, $tag$AND$tag$ FROM data WHERE value >= -12.5e2 AND fraction < .25 /* GROUP BY */;`;
  const tokens = tokenize(sql);
  assert.equal(tokens.map(token => token.text).join(''), sql);
  const typed = type => Array.from(tokens.filter(token => token.type === type), token => token.text);
  assert.deepEqual(typed('keyword'), ['SELECT', 'AS', 'FROM', 'WHERE', 'AND']);
  assert.deepEqual(typed('function'), ['SUM']);
  assert.deepEqual(typed('number'), ['12.5e2', '.25']);
  assert.equal(typed('string').length, 3);
  assert.deepEqual(typed('identifier'), ['"FROM"']);
  assert.equal(typed('comment').length, 2);
});
