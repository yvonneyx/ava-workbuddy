import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { root } from './metadata.js';
import { checkEnvironment } from './environment.js';
import { Runtime } from './runtime.js';

export async function runDemo(directory?: string) {
  checkEnvironment();
  let output: string;
  if (directory !== undefined) {
    if (!isAbsolute(directory)) throw new Error('Demo output directory must be an absolute, new directory.');
    await mkdir(directory);
    output = directory;
  } else output = await mkdtemp(join(tmpdir(), 'ava-workbuddy-demo-'));
  const runtime = new Runtime();
  let result;
  try {
    const csv = join(output, 'sales.csv');
    await copyFile(join(root, 'examples/sales.csv'), csv);
    const { datasetId } = await runtime.source(csv);
    const schema = await runtime.schema(datasetId);
    assert(schema.models.some((model) => model.tableReference?.table === 'data'), 'Unexpected demo table.');
    const sql = await readFile(join(root, 'examples/revenue-change.sql'), 'utf8');
    const contributions = await runtime.query(datasetId, sql);
    assert(!contributions.truncated && contributions.data.length === 4, 'Incomplete demo result.');
    const totals = await runtime.query(datasetId, 'SELECT month, SUM(revenue) AS revenue FROM data GROUP BY month ORDER BY month');
    assert(!totals.truncated && totals.data.length === 2, 'Incomplete totals.');
    const [januaryRow, februaryRow] = totals.data;
    assert(januaryRow && februaryRow, 'Missing monthly totals.');
    const january = Number(januaryRow.revenue);
    const february = Number(februaryRow.revenue);
    assert.equal(january, 30000); assert.equal(february, 37500);
    const expected: Record<string, number> = { Analytics: 6000, Automation: 2000, Support: 500, Reporting: -1000 };
    for (const row of contributions.data) assert.equal(Number(row.change), expected[String(row.product)]);
    assert.equal(contributions.data.reduce((sum, row) => sum + Number(row.change), 0), february - january);
    const spec = { chartType: 'bar', config: {
      type: 'bar', title: '各产品收入变化（2025 年 2 月相对 1 月，美元）',
      data: contributions.data.map((row) => ({ category: row.product, value: Number(row.change) })),
      axisXTitle: '产品', axisYTitle: '收入变化（美元）',
    } };
    const chart = await runtime.viz(spec, join(output, 'chart.html'));
    assert((await stat(chart.output)).size > 0, 'Empty HTML.');
    for (const [file, data] of Object.entries({ 'schema.json': schema, 'result.json': contributions, 'totals.json': totals, 'chart.json': spec })) {
      await writeFile(join(output, file), JSON.stringify(data, null, 2), { flag: 'wx' });
    }
    await writeFile(join(output, 'query.sql'), sql, { flag: 'wx' });
    const summary = '收入从 30,000 美元增至 37,500 美元，增加 7,500 美元（25%）。Analytics 增加 6,000 美元，占净增量的 80%；Reporting 减少 1,000 美元。分项变化已与总体核对。这份模拟数据无法说明变化原因。';
    await writeFile(join(output, 'report.txt'), `${summary}\n\n图表 HTML 已生成；浏览器预览尚未验证，需联网加载 GPT-Vis。\n`, { flag: 'wx' });
    result = { verified: true, january, february, change: february - january, growthRate: 0.25, summary,
      outputDirectory: output, chart: chart.output, results: join(output, 'result.json'), query: join(output, 'query.sql'),
      htmlGenerated: true, chartPreviewVerified: false, dataKind: 'synthetic-demo', sessionDisposedAfterCompletion: false };
  } finally {
    const cleanup = await runtime.close();
    if (result) result.sessionDisposedAfterCompletion = cleanup.retained.length === 0;
  }
  return result;
}

export async function smoke() {
  const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-smoke-'));
  try {
    const result = await runDemo(join(directory, 'check'));
    return { ...checkEnvironment(), computationVerified: result.verified, htmlGenerated: result.htmlGenerated };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
