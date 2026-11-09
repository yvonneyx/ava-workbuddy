import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validate } from '../scripts/validate.mjs';
import { copyAvaSkill } from '../scripts/ava-skill.mjs';

test('expert preloads the pinned upstream Skill without an MCP dependency', async () => {
  assert.equal((await validate()).valid, true);
});

test('unverified upstream downloads are rejected before extraction', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-skill-integrity-'));
  t.mock.method(globalThis, 'fetch', async () => new Response('unexpected archive'));
  try {
    await assert.rejects(copyAvaSkill(directory), { code: 'ERR_ASSERTION' });
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
