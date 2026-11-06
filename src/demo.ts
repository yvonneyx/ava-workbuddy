import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { root } from './metadata.js';
import { checkEnvironment } from './ava.js';
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
    // Round 1: establish the overall change before drilling into products.
    const totals = await runtime.query(datasetId, 'SELECT month, SUM(revenue) AS revenue FROM data GROUP BY month ORDER BY month');
    assert(!totals.truncated && totals.data.length === 2, 'Incomplete totals.');
    const [januaryRow, februaryRow] = totals.data;
    assert(januaryRow && februaryRow, 'Missing monthly totals.');
    const january = Number(januaryRow.revenue);
    const february = Number(februaryRow.revenue);
    assert.equal(january, 30000); assert.equal(february, 37500);
    // Round 2: inspect the contribution of each product.
    const sql = await readFile(join(root, 'examples/revenue-change.sql'), 'utf8');
    const contributions = await runtime.query(datasetId, sql);
    assert(!contributions.truncated && contributions.data.length === 4, 'Incomplete demo result.');
    const expected: Record<string, number> = { Analytics: 6000, Automation: 2000, Support: 500, Reporting: -1000 };
    for (const row of contributions.data) assert.equal(Number(row.change), expected[String(row.product)]);
    assert.equal(contributions.data.reduce((sum, row) => sum + Number(row.change), 0), february - january);
    // Round 3 follows the negative contribution found in the previous result.
    const declining = contributions.data.find((row) => Number(row.change) < 0)!;
    const product = String(declining.product);
    const decline = await runtime.query(datasetId, `SELECT month, SUM(revenue) AS revenue FROM data WHERE product = '${product.replaceAll("'", "''")}' GROUP BY month ORDER BY month`);
    assert(!decline.truncated && decline.data.length === 2, 'Incomplete product follow-up.');
    assert.equal(Number(decline.data[0]!.revenue), Number(declining.january));
    assert.equal(Number(decline.data[1]!.revenue), Number(declining.february));
    // Round 4: independently reconcile positive and negative changes in SQL.
    const reconciliation = await runtime.query(datasetId, `WITH products AS (
  SELECT product,
    SUM(CASE WHEN month = '2025-01' THEN revenue ELSE 0 END) AS january,
    SUM(CASE WHEN month = '2025-02' THEN revenue ELSE 0 END) AS february
  FROM data WHERE month IN ('2025-01', '2025-02') GROUP BY product
), totals AS (
  SELECT SUM(january) AS january, SUM(february) AS february,
    SUM(GREATEST(february - january, 0)) AS gross_increase,
    SUM(GREATEST(january - february, 0)) AS gross_decrease,
    SUM(february - january) AS product_net_change
  FROM products
)
SELECT january, february, february - january AS total_change,
  ROUND(100.0 * (february - january) / NULLIF(january, 0), 2) AS growth_pct,
  gross_increase, gross_decrease, product_net_change,
  product_net_change - (february - january) AS reconciliation_difference
FROM totals`);
    assert(!reconciliation.truncated && reconciliation.data.length === 1, 'Incomplete reconciliation.');
    const checked = reconciliation.data[0]!;
    assert.equal(Number(checked.total_change), february - january);
    assert.equal(Number(checked.growth_pct), 25);
    assert.equal(Number(checked.gross_increase), 8500);
    assert.equal(Number(checked.gross_decrease), 1000);
    assert.equal(Number(checked.reconciliation_difference), 0);
    const number = (value: unknown) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value));
    const overallConclusion = `收入从 ${number(january)} 美元增至 ${number(february)} 美元，净增加 ${number(checked.total_change)} 美元，环比增长 ${number(checked.growth_pct)}%。比较范围为示例数据中的四个产品，按自然月汇总。`;
    const contributionConclusion = contributions.data.map((row) => `${row.product} ${Number(row.change) < 0 ? '减少' : '增加'} ${number(Math.abs(Number(row.change)))} 美元`).join('；') + `。Analytics 贡献净增量的 ${number(100 * Number(contributions.data.find((row) => row.product === 'Analytics')!.change) / Number(checked.total_change))}%。`;
    const declineConclusion = `${product} 的收入从 ${number(declining.january)} 美元降至 ${number(declining.february)} 美元，减少 ${number(-Number(declining.change))} 美元，降幅为 ${number(-100 * Number(declining.change) / Number(declining.january))}%。数据只支持确认回落幅度，不能解释原因。`;
    const reconciliationConclusion = `增长产品合计增加 ${number(checked.gross_increase)} 美元，回落产品合计减少 ${number(checked.gross_decrease)} 美元，相抵后净增加 ${number(checked.product_net_change)} 美元，与总体增量 ${number(checked.total_change)} 美元一致，核对差额为 ${number(checked.reconciliation_difference)} 美元。`;
    const spec = { chartType: 'bar', config: {
      type: 'bar', title: '各产品收入变化（2025 年 2 月相对 1 月，美元）',
      data: contributions.data.map((row) => ({ category: row.product, value: Number(row.change) })),
      axisXTitle: '产品', axisYTitle: '收入变化（美元）',
    } };
    const chart = await runtime.viz(spec, join(output, 'chart.html'));
    assert((await stat(chart.output)).size > 0, 'Empty HTML.');
    for (const [file, data] of Object.entries({ 'schema.json': schema, 'result.json': contributions, 'totals.json': totals, 'decline.json': decline, 'reconciliation.json': reconciliation, 'chart.json': spec })) {
      await writeFile(join(output, file), JSON.stringify(data, null, 2), { flag: 'wx' });
    }
    await writeFile(join(output, 'query.sql'), sql, { flag: 'wx' });
    const summary = `${overallConclusion} ${reconciliationConclusion} 这份模拟数据无法说明变化原因。`;
    const artifact = await runtime.artifact({
      output: join(output, 'artifact.html'), title: '收入变化分析',
      summary: `收入净增加 ${number(checked.total_change)} 美元，环比增长 ${number(checked.growth_pct)}%。`,
      metrics: [
        { label: '1 月收入', queryId: totals.queryId, field: 'revenue', rowIndex: 0, unit: '美元' },
        { label: '2 月收入', queryId: totals.queryId, field: 'revenue', rowIndex: 1, unit: '美元' },
        { label: '净增加', queryId: reconciliation.queryId, field: 'total_change', unit: '美元' },
        { label: '环比增长', queryId: reconciliation.queryId, field: 'growth_pct', unit: '%' },
      ],
      sections: [
        { question: '这两个月，收入发生了什么变化？',
          conclusion: overallConclusion,
          queryId: totals.queryId, chart: { type: 'column', categoryField: 'month', valueField: 'revenue', categoryLabel: '月份', valueLabel: '收入（美元）' } },
        { question: '哪些产品贡献了增长，哪些在回落？',
          conclusion: contributionConclusion,
          queryId: contributions.queryId, chart: { type: 'bar', categoryField: 'product', valueField: 'change', categoryLabel: '产品', valueLabel: '收入变化（美元）' } },
        { question: `${product} 的回落幅度有多大？`, conclusion: declineConclusion,
          queryId: decline.queryId, chart: { type: 'line', categoryField: 'month', valueField: 'revenue', categoryLabel: '月份', valueLabel: '收入（美元）' } },
        { question: '产品增减能否与总体变化核对？', conclusion: reconciliationConclusion, queryId: reconciliation.queryId },
      ],
      definitions: ['时间：2025 年 1 月与 2 月，按自然月比较。', '指标：revenue 的合计值；金额单位为美元。', '产品变化 = 2 月收入 − 1 月收入；环比 = 收入变化 ÷ 1 月收入。'],
      limitations: ['本报告使用随包提供的 8 行模拟数据，并非用户的真实业务数据。', '数据未包含流量、价格、客户数量或成本，无法判断增长原因、利润变化或下一步投放预算。'],
    });
    const compactArtifact = await runtime.artifact({
      output: join(output, 'artifact-products.html'), title: '2 月各产品收入',
      summary: '2 月收入合计 37,500 美元，Analytics 收入最高，为 18,000 美元。',
      sections: [{ question: '各产品 2 月收入分别是多少？',
        conclusion: 'Analytics 为 18,000 美元，Automation 为 10,000 美元，Reporting 为 5,000 美元，Support 为 4,500 美元。合计 37,500 美元。',
        queryId: contributions.queryId, chart: { type: 'bar', categoryField: 'product', valueField: 'february', categoryLabel: '产品', valueLabel: '2 月收入（美元）' } }],
      definitions: ['使用结果表的 february 字段，金额单位为美元。'],
      limitations: ['使用 8 行模拟数据，不代表真实业务。'],
    });
    await writeFile(join(output, 'report.txt'), `${summary}\n\n图表 HTML 已生成；浏览器预览尚未验证，需联网加载 GPT-Vis。\n`, { flag: 'wx' });
    result = { verified: true, january, february, change: february - january, growthRate: 0.25, summary,
      outputDirectory: output, chart: chart.output, results: join(output, 'result.json'), query: join(output, 'query.sql'),
      artifact: artifact.output, artifactChartErrors: artifact.chartErrors,
      artifactData: artifact.dataOutput, alternateArtifact: compactArtifact.output, queryCount: artifact.queryCount,
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
