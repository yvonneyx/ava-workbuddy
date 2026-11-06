import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { root, metadata } from '../lib/metadata.js';
import { validate } from './validate.mjs';

await validate();
const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
const staging = await mkdtemp(join(tmpdir(), 'ava-workbuddy-pack-'));
const archives = [];
try {
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dist], {
    cwd: root, env, encoding: 'utf8',
  }));
  const tarball = join(dist, packed.filename);
  archives.push({ file: tarball, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex') });
  for (const [kind, directory] of [['connector', 'ava-connector'], ['expert', 'ava-workbuddy-assistant'], ['skill', 'ava']]) {
    const destination = join(staging, directory);
    await mkdir(destination);
    if (kind === 'connector') await cp(join(root, 'connector'), destination, { recursive: true });
    if (kind === 'expert') {
      await cp(join(root, 'expert'), destination, { recursive: true });
      await cp(join(root, 'connector/mcp.json'), join(destination, '.mcp.json'));
    }
    const skillDestination = kind === 'skill' ? destination : join(destination, 'skills/ava');
    await cp(join(root, 'skills/ava'), skillDestination, { recursive: true });
    for (const file of ['LICENSE', 'NOTICE']) await cp(join(root, file), join(destination, file));
    if (kind !== 'skill') {
      await cp(join(root, 'docs'), join(destination, 'docs'), { recursive: true });
      await writeFile(join(destination, 'README.md'), `# AVA WorkBuddy ${kind} ${metadata.version}\n\n${metadata.homepage}\n\nSee [publishing instructions](docs/publishing.md). Requires macOS/Linux and WorkBuddy 5.0.0+.\n\nThis is a community integration; no additional model key is required. See NOTICE for upstream attribution.\n`);
    }
    const archive = join(dist, `ava-workbuddy-${kind}-${metadata.version}.zip`);
    await rm(archive, { force: true });
    // Explicit directory input includes the dotfiles required by WorkBuddy expert packages.
    execFileSync('zip', ['-q', '-r', '-X', archive, directory], { cwd: staging });
    execFileSync('unzip', ['-tq', archive]);
    const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
    archives.push({ file: archive, sha256: digest });
  }
  await writeFile(join(dist, 'SHA256SUMS'), archives.map(({ file, sha256 }) => `${sha256}  ${basename(file)}`).join('\n') + '\n');
  console.log(JSON.stringify({ archives }, null, 2));
} finally { await rm(staging, { recursive: true, force: true }); }
