import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { root } from '../lib/metadata.js';
import { Runtime } from '../lib/index.js';
import { runDemo } from './demo.mjs';

// -----------------------------------------------------------------------------
// 真实 stdio MCP 连接
// -----------------------------------------------------------------------------

async function connect() {
  const client = new Client({ name: 'ava-workbuddy-integration-test', version: '0.1.0' });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === 'string'),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'lib/cli.js'), 'serve'],
    env,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  await client.connect(transport);
  return { client, stderr: () => stderr };
}
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, { timeout: 120000 });
  assert(!response.isError, response.content?.map((item) => item.text).join('\n'));
  return response.structuredContent ?? JSON.parse(response.content[0].text);
}

// -----------------------------------------------------------------------------
// 完整链路：文件、查询、图表、报告与重启
// -----------------------------------------------------------------------------

test(
  'MCP first use, CSV/XLSX, read-only queries, charts, errors, and restart',
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-集成 '));
    const connection = await connect();
    const client = connection.client;
    let id;
    try {
      const tools = await client.listTools();
      assert(client.getInstructions()?.trim());
      assert.equal(tools.tools.length, 8);
      assert(!tools.tools.some((tool) => tool.name === 'ava_demo'));
      assert.equal((await call(client, 'ava_check')).avaVersion, '4.0.0');
      const file = join(directory, '销售 $(literal) 数据.csv');
      await copyFile(join(root, 'tests/fixtures/sales.csv'), file);
      const original = await readFile(file);
      id = (await call(client, 'ava_source', { path: file })).datasetId;
      const schema = await call(client, 'ava_schema', { datasetId: id });
      assert.equal(schema.language.fence, 'sql');
      assert(schema.models.some((model) => model.tableReference?.table === 'data'));
      const result = await call(client, 'ava_query', {
        datasetId: id,
        sql: 'SELECT SUM(revenue) AS revenue FROM data',
      });
      assert.equal(Number(result.data[0].revenue), 67500);
      const report = await call(client, 'ava_artifact', {
        output: join(directory, 'artifact.html'),
        title: '集成测试报告',
        summary: '核对两个月收入合计。',
        metrics: [{ label: '合计', queryId: result.queryId, field: 'revenue', unit: '美元' }],
        sections: [
          { question: '总收入是多少？', conclusion: '合计 67,500 美元。', queryId: result.queryId },
        ],
      });
      const reportHTML = await readFile(report.output, 'utf8');
      assert(reportHTML.includes('67,500') && reportHTML.includes('SELECT SUM(revenue)'));
      const truncated = await call(client, 'ava_query', {
        datasetId: id,
        sql: 'SELECT * FROM data',
        maxRows: 1,
      });
      assert.equal(truncated.truncated, true);
      const mutation = await client.callTool({
        name: 'ava_query',
        arguments: { datasetId: id, sql: 'DELETE FROM data' },
      });
      assert.equal(mutation.isError, true);
      assert.deepEqual(await readFile(file), original);
      const semantic = { description: 'Revenue is in USD; compare calendar-month totals.' };
      await call(client, 'ava_semantic', { datasetId: id, definition: semantic });
      assert.deepEqual(await call(client, 'ava_semantic', { datasetId: id }), semantic);
      const output = join(directory, 'chart.html');
      await call(client, 'ava_viz', {
        spec: {
          chartType: 'bar',
          config: { type: 'bar', data: [{ category: 'Total', value: 67500 }] },
        },
        output,
      });
      assert((await stat(output)).size > 0);
      const duplicate = await client.callTool({
        name: 'ava_viz',
        arguments: { spec: { chartType: 'bar', config: {} }, output },
      });
      assert.equal(duplicate.isError, true);
      const beforeMissing = await readFile(output);
      const missing = await client.callTool({
        name: 'ava_source',
        arguments: { path: join(directory, 'missing.csv') },
      });
      assert.equal(missing.isError, true);
      assert.deepEqual(await readFile(output), beforeMissing);

      // -----------------------------------------------------------------------------
      // AVA 原生图表与复杂数据形状
      // -----------------------------------------------------------------------------

      const pie = await call(client, 'ava_query', {
        datasetId: id,
        sql:
          'SELECT product AS category, CAST(SUM(revenue) AS DOUBLE) AS value FROM data ' +
          'GROUP BY product ORDER BY product',
      });
      const histogram = await call(client, 'ava_query', {
        datasetId: id,
        sql: "SELECT {'data': list(CAST(revenue AS DOUBLE))} AS chart_config FROM data",
      });
      const dual = await call(client, 'ava_query', {
        datasetId: id,
        sql:
          "SELECT {'categories': list(month ORDER BY month), 'series': [{'type': " +
          "'column', 'axisYTitle': 'Revenue', 'data': list(revenue ORDER BY month)}]} " +
          'AS chart_config FROM (SELECT month, CAST(SUM(revenue) AS DOUBLE) AS revenue ' +
          'FROM data GROUP BY month)',
      });
      const liquid = await call(client, 'ava_query', {
        datasetId: id,
        sql:
          "SELECT {'percent': (MAX(revenue) - MIN(revenue)) / MIN(revenue)} AS " +
          'chart_config FROM (SELECT CAST(SUM(revenue) AS DOUBLE) AS revenue FROM data ' +
          'GROUP BY month)',
      });
      const native = await call(client, 'ava_artifact', {
        output: join(directory, 'native.html'),
        title: 'AVA 原生配置',
        summary: '图表直接使用查询证据。',
        sections: [
          {
            question: '产品收入占比',
            conclusion: '使用完整产品汇总。',
            queryId: pie.queryId,
            chart: { chartType: 'pie', config: { innerRadius: 0.6, theme: 'light' } },
          },
          {
            question: '收入分布',
            conclusion: '使用原始收入观测值。',
            queryId: histogram.queryId,
            chart: { chartType: 'histogram', config: { binNumber: 4 } },
            chartConfigField: 'chart_config',
          },
          {
            question: '月度序列',
            conclusion: '按月份排列。',
            queryId: dual.queryId,
            chart: { chartType: 'dual-axes', config: { axisXTitle: 'Month' } },
            chartConfigField: 'chart_config',
          },
          {
            question: '增长比例',
            conclusion: '增长 25%。',
            queryId: liquid.queryId,
            chart: { chartType: 'liquid', config: { shape: 'circle' } },
            chartConfigField: 'chart_config',
          },
        ],
      });
      assert.deepEqual(native.chartErrors, []);
      const nativeData = JSON.parse(await readFile(native.dataOutput, 'utf8'));
      const configs = nativeData.charts.map((chart) =>
        JSON.parse(chart.html.match(/const visConfig = (.*);/)[1]),
      );
      assert.deepEqual(
        configs.map((config) => config.type),
        ['pie', 'histogram', 'dual-axes', 'liquid'],
      );
      assert.deepEqual(configs[0].data, pie.data);
      assert.equal(configs[0].innerRadius, 0.6);
      assert.equal(configs[0].theme, 'light');
      assert.equal(configs[1].data.length, 8);
      assert.deepEqual(configs[2].categories, ['2025-01', '2025-02']);
      assert.deepEqual(configs[2].series[0].data, [30000, 37500]);
      assert.equal(configs[3].percent, 0.25);
      const unknown = await call(client, 'ava_artifact', {
        output: join(directory, 'unknown-chart.html'),
        title: 'Unknown chart',
        summary: 'Keep query evidence.',
        sections: [
          {
            question: 'Q',
            conclusion: 'C',
            queryId: pie.queryId,
            chart: { chartType: 'not-a-chart', config: {} },
          },
        ],
      });
      assert.match(unknown.chartErrors[0].message, /Unknown chartType/);

      // -----------------------------------------------------------------------------
      // 四轮示例与 Excel
      // -----------------------------------------------------------------------------

      const demo = await runDemo(new Runtime(), join(directory, 'demo'));
      assert.equal(demo.change, 7500);
      assert.equal(demo.chartPreviewVerified, false);
      assert.deepEqual(demo.artifactChartErrors, []);
      assert((await readFile(demo.artifact, 'utf8')).includes('收入变化分析'));
      const artifactData = JSON.parse(await readFile(demo.artifactData, 'utf8'));
      assert.equal(artifactData.sections.length, 4);
      assert.equal(demo.queryCount, 4);
      assert.equal(new Set(artifactData.sections.map((section) => section.queryId)).size, 4);
      assert.equal(artifactData.queries.length, 4);
      const evidence = new Map(artifactData.queries.map((query) => [query.queryId, query]));
      assert.equal(
        Number(evidence.get(artifactData.sections[0].queryId).result.data[0].value),
        30000,
      );
      assert.equal(evidence.get(artifactData.sections[1].queryId).result.data.length, 4);
      assert.equal(
        Number(evidence.get(artifactData.sections[2].queryId).result.data[0].value),
        6000,
      );
      assert.equal(
        Number(
          evidence.get(artifactData.sections[3].queryId).result.data[0].reconciliation_difference,
        ),
        0,
      );
      assert.equal(artifactData.charts.length, 3);
      assert.equal(
        evidence
          .get(artifactData.sections[1].queryId)
          .result.data.reduce((sum, row) => sum + Number(row.value), 0),
        7500,
      );
      assert.deepEqual((await readdir(demo.outputDirectory)).sort(), [
        'artifact.html',
        'artifact.json',
        'query.sql',
        'result.json',
        'sales.csv',
      ]);
      const xlsx = (
        await call(client, 'ava_source', { path: join(root, 'tests/fixtures/销售 数据.xlsx') })
      ).datasetId;
      const excelSchema = await call(client, 'ava_schema', { datasetId: xlsx });
      const table = excelSchema.models[0].tableReference.table;
      const excel = await call(client, 'ava_query', {
        datasetId: xlsx,
        sql: `SELECT SUM(revenue) AS revenue FROM "${table.replaceAll('"', '""')}"`,
      });
      assert.equal(Number(excel.data[0].revenue), 67500);
      await call(client, 'ava_dispose', { datasetId: xlsx });
      await call(client, 'ava_dispose', { datasetId: id });
      const expired = await client.callTool({ name: 'ava_schema', arguments: { datasetId: id } });
      assert.equal(expired.isError, true);
      id = (await call(client, 'ava_source', { path: file })).datasetId;
      await client.close();

      // -----------------------------------------------------------------------------
      // 断开连接后清理会话，重启后拒绝旧标识
      // -----------------------------------------------------------------------------

      // The transport closes the parent; its idle AVA session must be reaped.
      const socketDirectory = join(tmpdir(), `ava-${id}`);
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await access(socketDirectory);
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await assert.rejects(access(socketDirectory));
      const restarted = await connect();
      try {
        const stale = await restarted.client.callTool({
          name: 'ava_schema',
          arguments: { datasetId: id },
        });
        assert.equal(stale.isError, true);
        const reloaded = (await call(restarted.client, 'ava_source', { path: file })).datasetId;
        await call(restarted.client, 'ava_dispose', { datasetId: reloaded });
      } finally {
        await restarted.client.close();
      }
      assert(!connection.stderr().includes('Error:'), connection.stderr());
    } finally {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
