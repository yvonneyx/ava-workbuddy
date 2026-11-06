import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEnvironment, outputPath, Runtime, sourcePath } from '../src/runtime.mjs';
import { validate } from '../scripts/validate.mjs';

test('reject unsupported runtimes and platforms before creating sessions', () => {
  for (const version of ['20.19.5', '22.0.0', '22.12.0']) assert.throws(() => checkEnvironment(version, 'linux'), /22.13/);
  assert.throws(() => checkEnvironment('22.22.0', 'win32'), /Windows/);
  assert.equal(checkEnvironment('22.13.0', 'linux').ready, true);
  assert.equal(checkEnvironment('24.0.0', 'darwin').ready, true);
});

test('accept only absolute local file inputs and new HTML destinations', async () => {
  await assert.rejects(sourcePath('sales.csv'), /absolute/);
  await assert.rejects(sourcePath('https://example.com/sales.csv'), /absolute/);
  await assert.rejects(sourcePath('/tmp/credentials.txt'), /CSV and XLSX/);
  assert.throws(() => outputPath('chart.html'), /absolute/);
  assert.throws(() => outputPath('/tmp/file.js'), /\.html/);
  const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-unit-'));
  try {
    const file = join(directory, '销售 数据.csv'); await writeFile(file, 'x\n1');
    assert.match(await sourcePath(file), /销售 数据.csv$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('reject datasets created by another connection', async () => {
  const runtime = new Runtime();
  runtime.invoke = () => { throw new Error('Must not execute'); };
  await assert.rejects(runtime.schema('ds_other_012345abcdef'), /not owned/);
});

test('prevent concurrent commands and retain uncertain sessions for idle expiry', async () => {
  const runtime = new Runtime(); const id = 'ds_test_012345abcdef'; runtime.sessions.add(id);
  let release;
  runtime.invoke = () => new Promise((resolve) => { release = resolve; });
  const first = runtime.query(id, 'SELECT 1');
  await assert.rejects(runtime.query(id, 'SELECT 2'), /already running/);
  release({ data: [{ value: 1 }] }); await first;
  runtime.invoke = async () => { const error = new Error('timed out'); error.uncertain = true; throw error; };
  await assert.rejects(runtime.query(id, 'SELECT 3'), /timed out/);
  await assert.rejects(runtime.query(id, 'SELECT 3'), /uncertain/);
  await assert.rejects(runtime.dispose(id), /uncertain/);
  let calls = 0; runtime.invoke = async () => { calls++; };
  await runtime.close(); assert.equal(calls, 0);
});

test('cleanup is idempotent and disposes only owned sessions', async () => {
  const runtime = new Runtime(); runtime.sessions.add('ds_owned_012345abcdef');
  const calls = []; runtime.invoke = async (args) => { calls.push(args); };
  await Promise.all([runtime.close(), runtime.close()]);
  assert.deepEqual(calls, [['dispose', 'ds_owned_012345abcdef']]);
});

test('WorkBuddy packages reference complete, version-consistent resources', async () => {
  assert.equal((await validate()).valid, true);
});
