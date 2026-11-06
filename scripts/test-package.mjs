import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { root } from '../src/runtime.mjs';

const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dist], { cwd: root, env, encoding: 'utf8' }));
assert.equal(packed.length, 1);
assert(!packed[0].files.some(({ path }) => /(?:node_modules|test\/|\.env)/.test(path)));
const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-install-'));
try {
  const output = execFileSync('npm', ['exec', '--yes', '--prefer-offline', `--package=${join(dist, packed[0].filename)}`, '--', 'ava-workbuddy', 'smoke'], {
    cwd: directory, env, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024,
  });
  const result = JSON.parse(output);
  assert.equal(result.computationVerified, true);
  assert.equal(result.htmlGenerated, true);
  console.log(JSON.stringify({ package: packed[0].filename, freshDirectory: true, ...result }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
