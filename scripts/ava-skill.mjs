import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './metadata.mjs';

export const avaSkill = JSON.parse(await readFile(join(root, 'expert/ava-skill.json'), 'utf8'));

// -----------------------------------------------------------------------------
// 上游 Skill 原样提取；固定提交与校验和，避免打包时随分支漂移
// -----------------------------------------------------------------------------

export async function copyAvaSkill(destination) {
  assert.match(avaSkill.commit, /^[a-f0-9]{40}$/);
  assert.match(avaSkill.sha256, /^[a-f0-9]{64}$/);
  const directory = await mkdtemp(join(tmpdir(), 'ava-skill-'));
  try {
    const response = await fetch(
      `https://codeload.github.com/antvis/AVA/tar.gz/${avaSkill.commit}`,
      { signal: AbortSignal.timeout(90000) },
    );
    assert(response.ok, `AVA Skill download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), avaSkill.sha256);
    const archive = join(directory, 'ava.tar.gz');
    await writeFile(archive, bytes);
    execFileSync('tar', [
      '-xzf',
      archive,
      '-C',
      destination,
      '--strip-components=3',
      `AVA-${avaSkill.commit}/skills/ava`,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
