import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { root, metadata } from '../lib/metadata.js';
import { validate } from './validate.mjs';

// -----------------------------------------------------------------------------
// 校验配置并准备分发目录
// -----------------------------------------------------------------------------

await validate();
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const staging = await mkdtemp(join(tmpdir(), 'ava-workbuddy-pack-'));
const archives = [];
try {
  // -----------------------------------------------------------------------------
  // 预编译 npm 包
  // -----------------------------------------------------------------------------

  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
  const [packed] = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dist], {
      cwd: root,
      env,
      encoding: 'utf8',
    }),
  );
  const tarball = join(dist, packed.filename);
  archives.push({
    file: tarball,
    sha256: createHash('sha256')
      .update(await readFile(tarball))
      .digest('hex'),
  });

  // -----------------------------------------------------------------------------
  // WorkBuddy 连接器与专家包
  // -----------------------------------------------------------------------------

  for (const [kind, directory] of [
    ['connector', 'ava-connector'],
    ['expert', 'ava-data-analyst'],
  ]) {
    const destination = join(staging, directory);
    await mkdir(destination);
    if (kind === 'connector') {
      await cp(join(root, 'connector'), destination, { recursive: true });
      await cp(join(root, 'public/icon.svg'), join(destination, 'icon.svg'));
    }
    if (kind === 'expert') {
      await cp(join(root, 'expert'), destination, { recursive: true });
      await cp(join(root, 'public/avatars'), join(destination, 'avatars'), { recursive: true });
      await cp(join(root, 'connector/mcp.json'), join(destination, '.mcp.json'));
    }
    for (const file of ['LICENSE', 'NOTICE']) {
      await cp(join(root, file), join(destination, file));
    }
    await writeFile(
      join(destination, 'README.md'),
      `# AVA Data Analyst ${kind} ${metadata.version}\n\n` +
        `${metadata.homepage}\n\n` +
        'Requires macOS/Linux and WorkBuddy 5.0.0+.\n\n' +
        'This is a community integration; no additional model key is required. ' +
        'See NOTICE for upstream attribution.\n',
    );
    const archive = join(dist, `ava-workbuddy-${kind}-${metadata.version}.zip`);
    // Explicit directory input includes the dotfiles required by WorkBuddy expert packages.
    execFileSync('zip', ['-q', '-r', '-X', archive, directory], { cwd: staging });
    execFileSync('unzip', ['-tq', archive]);
    const digest = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    archives.push({ file: archive, sha256: digest });
  }

  // -----------------------------------------------------------------------------
  // 记录所有分发包的校验和
  // -----------------------------------------------------------------------------

  await writeFile(
    join(dist, 'SHA256SUMS'),
    archives.map(({ file, sha256 }) => `${sha256}  ${basename(file)}`).join('\n') + '\n',
  );
  console.log(JSON.stringify({ archives }, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}
