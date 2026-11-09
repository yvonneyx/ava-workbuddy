import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { root, metadata } from './metadata.mjs';
import { validate } from './validate.mjs';
import { copyAvaSkill } from './ava-skill.mjs';

// -----------------------------------------------------------------------------
// 只分发专家包；Skill 与报告资源均从上游固定版本提取
// -----------------------------------------------------------------------------

await validate();
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const staging = await mkdtemp(join(tmpdir(), 'ava-workbuddy-pack-'));
try {
  const directory = 'ava-data-analyst';
  const destination = join(staging, directory);
  await cp(join(root, 'expert'), destination, { recursive: true });
  await cp(join(root, 'public/avatars'), join(destination, 'avatars'), { recursive: true });
  await cp(join(root, 'public/expert-icon.svg'), join(destination, 'icon.svg'));
  for (const file of ['LICENSE', 'NOTICE', 'README.md']) {
    await cp(join(root, file), join(destination, file));
  }
  // README 中的本地说明随包提供，接收方无需访问源码仓库。
  await cp(join(root, 'docs'), join(destination, 'docs'), { recursive: true });
  const skill = join(destination, 'skills/ava');
  await mkdir(skill, { recursive: true });
  await copyAvaSkill(skill);
  const archive = join(dist, `ava-workbuddy-expert-${metadata.version}.zip`);
  execFileSync('zip', ['-q', '-r', '-X', archive, directory], { cwd: staging });
  execFileSync('unzip', ['-tq', archive]);
  const sha256 = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  await writeFile(join(dist, 'SHA256SUMS'), `${sha256}  ${basename(archive)}\n`);
  console.log(JSON.stringify({ archive, sha256 }, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}
