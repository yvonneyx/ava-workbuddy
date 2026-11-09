import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { root, metadata } from './metadata.mjs';
import { runSkillDemo } from '../tests/skill-demo.mjs';

// -----------------------------------------------------------------------------
// 分发内容和真实 CLI 报告；只读取解包后的 Skill
// -----------------------------------------------------------------------------

const archive = join(root, 'dist', `ava-workbuddy-expert-${metadata.version}.zip`);
assert.deepEqual((await readdir(join(root, 'dist'))).sort(), [
  'SHA256SUMS',
  archive.split('/').at(-1),
]);
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
assert(!entries.some((path) => /(?:mcp|node_modules|\/src\/|\/lib\/|\.tgz$)/i.test(path)));
const files = [
  'SKILL.md',
  'scripts/report.mjs',
  'references/reports.md',
  'references/semantic.md',
  'references/setup.md',
  'references/sources.md',
  'references/queries.md',
  'references/visualization.md',
  'assets/report.html',
  'assets/icon.svg',
  'assets/LICENSE',
];
for (const file of files) assert(entries.includes(`ava-data-analyst/skills/ava/${file}`));
for (const [entry, source] of [
  ['avatars/expert.png', 'public/avatars/expert.png'],
  ['icon.svg', 'public/expert-icon.svg'],
  ['README.md', 'README.md'],
  ['ava-skill.json', 'expert/ava-skill.json'],
  ['.codebuddy-plugin/plugin.json', 'expert/.codebuddy-plugin/plugin.json'],
  ['agents/ava-data-analyst.md', 'expert/agents/ava-data-analyst.md'],
]) {
  assert.deepEqual(
    execFileSync('unzip', ['-p', archive, `ava-data-analyst/${entry}`]),
    await readFile(join(root, source)),
    entry,
  );
}
const sha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
assert.equal(
  await readFile(join(root, 'dist/SHA256SUMS'), 'utf8'),
  `${sha256}  ${archive.split('/').at(-1)}\n`,
);
const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-install-'));
try {
  execFileSync('unzip', ['-q', archive, '-d', directory]);
  const skill = join(directory, 'ava-data-analyst/skills/ava');
  // 校验所有 Skill 文档中的相对引用，避免仅打包入口导致功能丢失。
  for (const file of files.filter((path) => path.endsWith('.md'))) {
    for (const [, target] of (await readFile(join(skill, file), 'utf8')).matchAll(
      /\]\(([^)]+)\)/g,
    )) {
      if (/^(?:https?:|#)/.test(target)) continue;
      await readFile(new URL(target.split('#')[0], pathToFileURL(join(skill, file))));
    }
  }
  const require = createRequire(import.meta.url);
  const avaPackage = require.resolve('@antv/ava/package.json');
  assert.equal(JSON.parse(await readFile(avaPackage, 'utf8')).version, '4.0.0');
  const report = await runSkillDemo(
    skill,
    join(directory, 'demo'),
    join(avaPackage, '..', 'lib/cli/index.js'),
  );
  console.log(JSON.stringify({ archive, avaVersion: '4.0.0', report }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
