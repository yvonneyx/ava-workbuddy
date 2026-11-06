import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// -----------------------------------------------------------------------------
// 完整示例：四轮分析与一份报告

// -----------------------------------------------------------------------------
// 调用方传入专用 Runtime；helper 负责在结束时释放其会话。
export async function runDemo(runtime, output) {
  await mkdir(output);
  const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
  let result;
  try {
    const csv = join(output, 'sales.csv');
    await copyFile(join(fixtures, 'sales.csv'), csv);
    const { datasetId } = await runtime.source(csv);
    const schema = await runtime.schema(datasetId);
    assert(
      schema.models.some((model) => model.tableReference?.table === 'data'),
      'Unexpected demo table.',
    );

    // -----------------------------------------------------------------------------
    // 第一轮：总体变化

    // -----------------------------------------------------------------------------
    const totals = await runtime.query(
      datasetId,
      'SELECT month AS category, CAST(SUM(revenue) AS DOUBLE) AS value FROM data ' +
        'GROUP BY month ORDER BY month',
    );
    assert(!totals.truncated && totals.data.length === 2, 'Incomplete totals.');
    const [januaryRow, februaryRow] = totals.data;
    assert(januaryRow && februaryRow, 'Missing monthly totals.');
    const january = Number(januaryRow.value);
    const february = Number(februaryRow.value);
    assert.equal(january, 30000);
    assert.equal(february, 37500);

    // -----------------------------------------------------------------------------
    // 第二轮：产品贡献

    // -----------------------------------------------------------------------------
    const sql = await readFile(join(fixtures, 'revenue-change.sql'), 'utf8');
    const contributions = await runtime.query(datasetId, sql);
    assert(!contributions.truncated && contributions.data.length === 4, 'Incomplete demo result.');
    const expected = {
      Analytics: 6000,
      Automation: 2000,
      Support: 500,
      Reporting: -1000,
    };
    for (const row of contributions.data) {
      assert.equal(Number(row.value), expected[String(row.category)]);
    }
    assert.equal(
      contributions.data.reduce((sum, row) => sum + Number(row.value), 0),
      february - january,
    );

    // -----------------------------------------------------------------------------
    // 第三轮：追问回落产品

    // -----------------------------------------------------------------------------
    const declining = contributions.data.find((row) => Number(row.value) < 0);
    const product = String(declining.category);
    const decline = await runtime.query(
      datasetId,
      `SELECT month AS time, CAST(SUM(revenue) AS DOUBLE) AS value FROM data WHERE product = '${product.replaceAll(
        "'",
        "''",
      )}' GROUP BY month ORDER BY month`,
    );
    assert(!decline.truncated && decline.data.length === 2, 'Incomplete product follow-up.');
    assert.equal(Number(decline.data[0].value), Number(declining.january));
    assert.equal(Number(decline.data[1].value), Number(declining.february));

    // -----------------------------------------------------------------------------
    // 第四轮：独立核对增减合计

    // -----------------------------------------------------------------------------
    const reconciliation = await runtime.query(
      datasetId,
      `WITH products AS (
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
FROM totals`,
    );
    assert(
      !reconciliation.truncated && reconciliation.data.length === 1,
      'Incomplete reconciliation.',
    );
    const checked = reconciliation.data[0];
    assert.equal(Number(checked.total_change), february - january);
    assert.equal(Number(checked.growth_pct), 25);
    assert.equal(Number(checked.gross_increase), 8500);
    assert.equal(Number(checked.gross_decrease), 1000);
    assert.equal(Number(checked.reconciliation_difference), 0);

    // -----------------------------------------------------------------------------
    // 将核实结果组织为报告

    // -----------------------------------------------------------------------------
    const number = (value) =>
      new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value));
    const overallConclusion =
      `收入从 ${number(january)} 美元增至 ${number(february)} 美元，` +
      `净增加 ${number(checked.total_change)} 美元，` +
      `环比增长 ${number(checked.growth_pct)}%。` +
      '比较范围为示例数据中的四个产品，按自然月汇总。';
    const contributionConclusion =
      contributions.data
        .map(
          (row) =>
            `${row.category} ${Number(row.value) < 0 ? '减少' : '增加'} ` +
            `${number(Math.abs(Number(row.value)))} 美元`,
        )
        .join('；') +
      `。Analytics 贡献净增量的 ${number(
        (100 * Number(contributions.data.find((row) => row.category === 'Analytics').value)) /
          Number(checked.total_change),
      )}%。`;
    const declineConclusion =
      `${product} 的收入从 ${number(declining.january)} 美元降至 ` +
      `${number(declining.february)} 美元，` +
      `减少 ${number(-Number(declining.value))} 美元，` +
      `降幅为 ${number((-100 * Number(declining.value)) / Number(declining.january))}%。` +
      '数据只支持确认回落幅度，不能解释原因。';
    const reconciliationConclusion =
      `增长产品合计增加 ${number(checked.gross_increase)} 美元，` +
      `回落产品合计减少 ${number(checked.gross_decrease)} 美元，` +
      `相抵后净增加 ${number(checked.product_net_change)} 美元，` +
      `与总体增量 ${number(checked.total_change)} 美元一致，` +
      `核对差额为 ${number(checked.reconciliation_difference)} 美元。`;
    await writeFile(join(output, 'result.json'), JSON.stringify(contributions, null, 2), {
      flag: 'wx',
    });
    await writeFile(join(output, 'query.sql'), sql, { flag: 'wx' });
    const summary = `${overallConclusion} ${reconciliationConclusion} 这份模拟数据无法说明变化原因。`;
    const artifact = await runtime.artifact({
      output: join(output, 'artifact.html'),
      title: '收入变化分析',
      summary: `收入净增加 ${number(checked.total_change)} 美元，环比增长 ${number(
        checked.growth_pct,
      )}%。`,
      metrics: [
        { label: '1 月收入', queryId: totals.queryId, field: 'value', rowIndex: 0, unit: '美元' },
        { label: '2 月收入', queryId: totals.queryId, field: 'value', rowIndex: 1, unit: '美元' },
        { label: '净增加', queryId: reconciliation.queryId, field: 'total_change', unit: '美元' },
        { label: '环比增长', queryId: reconciliation.queryId, field: 'growth_pct', unit: '%' },
      ],
      sections: [
        {
          question: '这两个月，收入发生了什么变化？',
          conclusion: overallConclusion,
          queryId: totals.queryId,
          chart: {
            chartType: 'column',
            config: { axisXTitle: '月份', axisYTitle: '收入（美元）' },
          },
        },
        {
          question: '哪些产品贡献了增长，哪些在回落？',
          conclusion: contributionConclusion,
          queryId: contributions.queryId,
          chart: {
            chartType: 'bar',
            config: { axisXTitle: '产品', axisYTitle: '收入变化（美元）' },
          },
        },
        {
          question: `${product} 的回落幅度有多大？`,
          conclusion: declineConclusion,
          queryId: decline.queryId,
          chart: { chartType: 'line', config: { axisXTitle: '月份', axisYTitle: '收入（美元）' } },
        },
        {
          question: '产品增减能否与总体变化核对？',
          conclusion: reconciliationConclusion,
          queryId: reconciliation.queryId,
        },
      ],
      definitions: [
        '时间：2025 年 1 月与 2 月，按自然月比较。',
        '指标：revenue 的合计值；金额单位为美元。',
        '产品变化 = 2 月收入 − 1 月收入；环比 = 收入变化 ÷ 1 月收入。',
      ],
      limitations: [
        '本报告使用测试夹具中的 8 行模拟数据，并非用户的真实业务数据。',
        '数据未包含流量、价格、客户数量或成本，无法判断增长原因、利润变化或下一步投放预算。',
      ],
    });
    assert.deepEqual(artifact.chartErrors, [], 'Demo charts failed.');
    result = {
      verified: true,
      january,
      february,
      change: february - january,
      growthRate: 0.25,
      summary,
      outputDirectory: output,
      results: join(output, 'result.json'),
      query: join(output, 'query.sql'),
      artifact: artifact.output,
      artifactChartErrors: artifact.chartErrors,
      artifactData: artifact.dataOutput,
      queryCount: artifact.queryCount,
      htmlGenerated: true,
      chartPreviewVerified: false,
      dataKind: 'synthetic-demo',
      sessionDisposedAfterCompletion: false,
    };
  } finally {
    const cleanup = await runtime.close();
    if (result) {
      result.sessionDisposedAfterCompletion = cleanup.retained.length === 0;
    }
  }
  return result;
}
