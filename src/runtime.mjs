import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
export const root = fileURLToPath(new URL('../', import.meta.url));
export const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const avaMetadataPath = require.resolve('@antv/ava/package.json');
const avaMetadata = JSON.parse(await readFile(avaMetadataPath, 'utf8'));
const avaCLI = resolve(dirname(avaMetadataPath), avaMetadata.bin.ava);

export function checkEnvironment(nodeVersion = process.versions.node, platform = process.platform) {
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 13))) throw new Error('Node.js 22.13.0 or newer is required.');
  if (!['darwin', 'linux'].includes(platform)) throw new Error('AVA sessions currently support macOS/Linux only. Windows is not supported in v0.1.0.');
  if (avaMetadata.version !== metadata.dependencies['@antv/ava']) throw new Error('Installed AVA does not match the pinned version. Reinstall this integration.');
  return { ready: true, integrationVersion: metadata.version, avaVersion: avaMetadata.version, nodeVersion, platform, authentication: 'none-local-stdio', chartPreviewVerified: false };
}

export async function sourcePath(path) {
  if (!isAbsolute(path)) throw new Error('Provide an absolute path to the local file supplied by the user.');
  if (!['.csv', '.xlsx'].includes(extname(path).toLowerCase())) throw new Error('v0.1.0 accepts local CSV and XLSX files only.');
  const resolved = await realpath(path);
  if (!(await stat(resolved)).isFile()) throw new Error('The source must be a regular file.');
  await access(resolved);
  return resolved;
}

export function outputPath(path) {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.html') throw new Error('Provide an absolute output path ending in .html. Existing files are not overwritten.');
  return path;
}

export class Runtime {
  sessions = new Set();
  busy = new Set();
  uncertain = new Set();
  pending = new Set();
  closing = false;

  async invoke(args, input) {
    checkEnvironment();
    const env = { ...process.env };
    // WorkBuddy supplies the reasoning; this integration never forwards model credentials to AVA.
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_MODEL;
    delete env.OPENAI_BASE_URL;
    const operation = new Promise((resolveResult, reject) => {
      const child = execFile(process.execPath, [avaCLI, ...args], {
        env, cwd: root, timeout: 75_000, maxBuffer: 20 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          const failure = new Error(error.killed
            ? 'AVA command timed out; the operation may still be running. Do not automatically retry or dispose this session.'
            : stderr.trim() || error.message);
          failure.uncertain = Boolean(error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
          reject(failure);
          return;
        }
        try { resolveResult(JSON.parse(stdout)); }
        catch { reject(new Error('AVA returned invalid JSON.')); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input ?? '');
    });
    this.pending.add(operation);
    try { return await operation; }
    finally { this.pending.delete(operation); }
  }

  async source(path) {
    if (this.closing) throw new Error('The integration is shutting down.');
    const result = await this.invoke(['source', await sourcePath(path)]);
    this.sessions.add(result.datasetId);
    return result;
  }

  async session(id, args, input) {
    if (this.closing) throw new Error('The integration is shutting down.');
    if (!this.sessions.has(id)) throw new Error('This dataset is not owned by this MCP connection. Load the source again.');
    if (this.uncertain.has(id)) throw new Error('A previous operation has an uncertain outcome. Do not retry or dispose it automatically; inspect the task first.');
    if (this.busy.has(id)) throw new Error('A command is already running for this dataset. Wait for its result.');
    this.busy.add(id);
    try {
      const result = await this.invoke([args[0], id, ...args.slice(1)], input);
      if (args[0] === 'dispose') this.sessions.delete(id);
      return result;
    } catch (error) {
      if (error.uncertain) this.uncertain.add(id);
      throw error;
    } finally { this.busy.delete(id); }
  }

  async schema(id) { return this.session(id, ['schema']); }
  async query(id, dsl, maxRows) {
    if (!dsl.trim() || Buffer.byteLength(dsl) > 512 * 1024) throw new Error('SQL must be non-empty and at most 512 KiB.');
    if (maxRows !== undefined && (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000)) throw new Error('maxRows must be between 1 and 10000.');
    return this.session(id, ['query', '--dsl', '-', ...(maxRows ? ['--max-rows', String(maxRows)] : [])], dsl);
  }
  async semantic(id, definition) {
    if (definition === undefined) return this.session(id, ['semantic']);
    const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-semantic-'));
    try {
      const file = join(directory, 'semantic.json');
      await writeFile(file, JSON.stringify(definition), { mode: 0o600 });
      return await this.session(id, ['semantic', '--file', file]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  async viz(spec, output) {
    return this.invoke(['viz', '--spec', '-', '--output', outputPath(output)], JSON.stringify(spec));
  }
  async dispose(id) { return this.session(id, ['dispose']); }

  async close() {
    if (this.cleanup) return this.cleanup;
    this.closing = true;
    this.cleanup = (async () => {
      await Promise.allSettled([...this.pending]);
      for (const id of this.sessions) {
        if (this.uncertain.has(id)) continue;
        try { await this.invoke(['dispose', id]); }
        catch (error) { process.stderr.write(`Session cleanup: ${error.message}\n`); }
        this.sessions.delete(id);
      }
    })();
    return this.cleanup;
  }
}

export async function runDemo(directory) {
  checkEnvironment();
  let output;
  if (directory !== undefined) {
    if (!isAbsolute(directory)) throw new Error('Demo output directory must be an absolute, new directory.');
    await mkdir(directory);
    output = directory;
  } else output = await mkdtemp(join(tmpdir(), 'ava-workbuddy-demo-'));
  const runtime = new Runtime();
  try {
    const csv = join(output, 'sales.csv');
    await copyFile(join(root, 'examples/sales.csv'), csv);
    const { datasetId } = await runtime.source(csv);
    const schema = await runtime.schema(datasetId);
    assert(schema.models.some((model) => model.tableReference?.table === 'data'), 'Unexpected demo table.');
    const sql = await readFile(join(root, 'examples/revenue-change.sql'), 'utf8');
    const result = await runtime.query(datasetId, sql);
    assert(!result.truncated && result.data.length === 4, 'Incomplete demo result.');
    const totals = await runtime.query(datasetId, 'SELECT month, SUM(revenue) AS revenue FROM data GROUP BY month ORDER BY month');
    assert(!totals.truncated && totals.data.length === 2, 'Incomplete totals.');
    const january = Number(totals.data[0].revenue);
    const february = Number(totals.data[1].revenue);
    assert.equal(january, 30000); assert.equal(february, 37500);
    const expected = { Analytics: 6000, Automation: 2000, Support: 500, Reporting: -1000 };
    for (const row of result.data) assert.equal(Number(row.change), expected[row.product]);
    assert.equal(result.data.reduce((sum, row) => sum + Number(row.change), 0), february - january);
    const spec = { chartType: 'bar', config: {
      type: 'bar', title: '各产品收入变化（2025 年 2 月相对 1 月，美元）',
      data: result.data.map((row) => ({ category: row.product, value: Number(row.change) })),
      axisXTitle: '产品', axisYTitle: '收入变化（美元）',
    } };
    const chart = await runtime.viz(spec, join(output, 'chart.html'));
    assert((await stat(chart.output)).size > 0, 'Empty HTML.');
    for (const [file, data] of Object.entries({ 'schema.json': schema, 'result.json': result, 'totals.json': totals, 'chart.json': spec })) {
      await writeFile(join(output, file), JSON.stringify(data, null, 2), { flag: 'wx' });
    }
    await writeFile(join(output, 'query.sql'), sql, { flag: 'wx' });
    const summary = '收入从 30,000 美元增至 37,500 美元，增加 7,500 美元（25%）。Analytics 增加 6,000 美元，占净增量的 80%；Reporting 减少 1,000 美元。分项变化已与总体核对。这份模拟数据无法说明变化原因。';
    await writeFile(join(output, 'report.txt'), `${summary}\n\n图表 HTML 已生成；浏览器预览尚未验证，需联网加载 GPT-Vis。\n`, { flag: 'wx' });
    return { verified: true, january, february, change: february - january, growthRate: 0.25, summary,
      outputDirectory: output, chart: chart.output, results: join(output, 'result.json'), query: join(output, 'query.sql'),
      htmlGenerated: true, chartPreviewVerified: false, dataKind: 'synthetic-demo', sessionDisposedAfterCompletion: true };
  } finally { await runtime.close(); }
}

export async function smoke() {
  const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-smoke-'));
  try {
    const result = await runDemo(join(directory, 'check'));
    return { ...checkEnvironment(), computationVerified: result.verified, htmlGenerated: result.htmlGenerated };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
