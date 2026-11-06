import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { root, metadata } from '../lib/metadata.js';

// -----------------------------------------------------------------------------
// 分发内容与隔离安装
// -----------------------------------------------------------------------------

const archive = join(root, 'dist', `ava-workbuddy-${metadata.version}.tgz`);
const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
assert(files.includes('package/lib/index.js') && files.includes('package/lib/index.d.ts'));
assert(files.includes('package/public/artifact.html'));
assert(files.includes('package/public/icon.svg'));
assert(files.includes('package/npm-shrinkwrap.json'));
assert(
  !files.some((path) => /(?:CONTRIBUTING\.md|CHANGELOG\.md|docs\/publishing\.md)$/.test(path)),
);
assert(!files.some((path) => /(?:node_modules|\/tests?\/|\/scripts\/|\.env)/.test(path)));
assert(!files.some((path) => /\/(?:examples|templates|avatars|skills)\//.test(path)));

// 分发路径可以不同，MCP 配置和资源必须与维护源逐字节一致。
const copies = [
  ['connector', 'ava-connector/icon.svg', 'public/icon.svg'],
  ['expert', 'ava-data-analyst/avatars/expert.png', 'public/avatars/expert.png'],
  ['connector', 'ava-connector/mcp.json', 'connector/mcp.json'],
  ['expert', 'ava-data-analyst/.mcp.json', 'connector/mcp.json'],
];
const archives = (await readdir(join(root, 'dist'))).filter((name) => /\.(tgz|zip)$/.test(name));
assert.deepEqual(archives.sort(), [
  `ava-workbuddy-${metadata.version}.tgz`,
  `ava-workbuddy-connector-${metadata.version}.zip`,
  `ava-workbuddy-expert-${metadata.version}.zip`,
]);
for (const kind of ['connector', 'expert']) {
  const zip = join(root, 'dist', `ava-workbuddy-${kind}-${metadata.version}.zip`);
  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n');
  assert(!entries.some((path) => /\/skills\//.test(path)), `${kind} contains a stale Skill`);
}
for (const [kind, entry, source] of copies) {
  const zip = join(root, 'dist', `ava-workbuddy-${kind}-${metadata.version}.zip`);
  assert.deepEqual(
    execFileSync('unzip', ['-p', zip, entry]),
    await readFile(join(root, source)),
    `${kind}: ${entry}`,
  );
}
const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-install-'));
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
try {
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund', archive],
    {
      cwd: directory,
      env,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  // -----------------------------------------------------------------------------
  // 真实消费端的类型声明
  // -----------------------------------------------------------------------------

  // This is a consumer project, so exports and declarations resolve through node_modules.
  await writeFile(
    join(directory, 'consumer.ts'),
    `
import {
  Runtime,
  checkEnvironment,
  type ArtifactInput,
  type QueryResult,
  type CleanupReport,
  type SourceConfig,
  type FileSourceType,
  type ChartSpec,
} from 'ava-workbuddy';
import { createServer } from 'ava-workbuddy/mcp';
const runtime = new Runtime();
const source = await runtime.source('/tmp/sales.csv');
const sourceConfig: SourceConfig = { type: 'json', options: { data: [{ value: 1 }] } };
const inline = await runtime.source(sourceConfig);
const fileType: FileSourceType = 'json-file';
await runtime.source('https://example.com/data', fileType);
await runtime.dispose(inline.datasetId);
const result: QueryResult = await runtime.query(source.datasetId, 'SELECT 1');
const rows: Record<string, unknown>[] = result.data;
const cleanup: CleanupReport = await runtime.close();
const report: ArtifactInput = {
  output: '/tmp/native.html',
  title: 'Native chart',
  summary: 'Query evidence',
  sections: [
    {
      question: 'Distribution',
      conclusion: 'Verified',
      queryId: 'q_example',
      chart: { chartType: 'histogram', config: { binNumber: 10, theme: 'light' } },
      chartConfigField: 'chart_config',
    },
  ],
};
const monthly: ArtifactInput = {
  output: '/tmp/monthly.html', title: 'Revenue', summary: 'Verified',
  sections: [{ question: 'Q', conclusion: 'C', queryId: 'q_example',
    chart: { chartType: 'column', config: { axisYTitle: 'Revenue' } },
    chartFields: { category: 'month', value: 'total_revenue' },
  }],
};
const standalone: ChartSpec = {
  chartType: 'column', config: { data: [{ category: 'Jan', value: 10 }] },
};
const embedded = createServer();
await embedded.close();
console.log(rows, report, monthly, standalone, cleanup.retained, checkEnvironment().avaVersion);
// @ts-expect-error Chart types are limited to the pinned AVA renderer.
const unsupportedChart: ChartSpec = { chartType: 'unsupported', config: {} };
// @ts-expect-error SQL must be a string, never arbitrary execution options.
runtime.query(source.datasetId, 123);
// @ts-expect-error Native source types must be supported by AVA.
runtime.source({ type: 'unsupported', options: {} });
// @ts-expect-error Internal session ownership is not a mutable public field.
runtime.sessions.add('ds_other');
`,
  );
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      '--types',
      'node',
      '--typeRoots',
      join(root, 'node_modules/@types'),
      'consumer.ts',
    ],
    {
      cwd: directory,
      env,
      encoding: 'utf8',
      timeout: 30000,
    },
  );

  // -----------------------------------------------------------------------------
  // 公开 API 与首次分析
  // -----------------------------------------------------------------------------

  const imported = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { Runtime, checkEnvironment } from 'ava-workbuddy';
import { createServer } from 'ava-workbuddy/mcp';
import { runDemo } from ${JSON.stringify(join(root, 'tests/demo.mjs'))};

const result = await runDemo(new Runtime(), ${JSON.stringify(join(directory, 'demo'))});
if (!result.sessionDisposedAfterCompletion) {
  throw new Error('Leaked library session');
}
await createServer().close();
console.log(JSON.stringify({
  ...checkEnvironment(),
  computationVerified: result.verified,
  htmlGenerated: result.htmlGenerated,
}));
`,
    ],
    { cwd: directory, env, encoding: 'utf8', timeout: 180000 },
  );
  const result = JSON.parse(imported);
  assert.equal(result.avaVersion, '4.0.0');
  assert.equal(result.computationVerified, true);
  assert.equal(result.htmlGenerated, true);

  const checked = execFileSync(
    process.execPath,
    [join(directory, 'node_modules/ava-workbuddy/lib/cli.js'), 'check'],
    { cwd: directory, env, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(JSON.parse(checked).avaVersion, '4.0.0');
  const sums = await readFile(join(root, 'dist/SHA256SUMS'), 'utf8');
  assert(sums.includes(`ava-workbuddy-${metadata.version}.tgz`));
  console.log(
    JSON.stringify(
      {
        package: archive,
        freshDirectory: true,
        publicApiVerified: true,
        typesVerified: true,
        ...result,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
