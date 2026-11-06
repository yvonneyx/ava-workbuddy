import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AVACommandError, checkEnvironment, Runtime } from '../lib/index.js';
import { outputPath, sourcePath } from '../lib/paths.js';
import { root } from '../lib/metadata.js';
import { validate } from '../scripts/validate.mjs';
import { createServer } from '../lib/server.js';
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
  release(rows); assert.deepEqual(await first, rows);
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
