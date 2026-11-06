import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  access,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { DuckDBInstance } from '@duckdb/node-api';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
// 新增数据源：真实文件、内联数据、原生配置与远程下载
// -----------------------------------------------------------------------------

test(
  'MCP redacts database credentials from schema and query errors',
  { timeout: 30000 },
  async () => {
    const secret = 'integration-dummy-password';
    const remote = createServer((request, response) => {
      request.resume();
      response.writeHead(401, { 'Content-Type': 'text/plain' });
      response.end(`Authentication failed; password=${secret}`);
    });
    remote.listen(0, '127.0.0.1');
    await once(remote, 'listening');
    let connection;
    try {
      connection = await connect();
      const { client } = connection;
      const source = await call(client, 'ava_source', {
        config: {
          type: 'clickhouse',
          options: {
            url: `http://127.0.0.1:${remote.address().port}`,
            database: 'sales',
            username: 'test',
            password: secret,
          },
        },
      });
      for (const name of ['ava_schema', 'ava_query']) {
        const result = await client.callTool({
          name,
          arguments: { ...source, ...(name === 'ava_query' ? { sql: 'SELECT 1' } : {}) },
        });
        assert.equal(result.isError, true);
        const message = result.content.map((item) => item.text).join('\n');
        assert.match(message, /Authentication failed/);
        assert.match(message, /\[redacted\]/);
        assert(!message.includes(secret));
      }
      await call(client, 'ava_dispose', source);
    } finally {
      await connection?.client.close();
      await new Promise((resolve) => remote.close(resolve));
    }
  },
);

test(
  'MCP loads JSON, Parquet, SQLite, inline CSV/JSON and authenticated HTTP sources',
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ava-all-sources-'));
    const connection = await connect();
    const client = connection.client;
    const json = join(directory, '数据.json');
    const unrelated = join(directory, 'unrelated-private.txt');
    const parquet = join(directory, 'data.parquet');
    const sqlite = join(directory, 'data.sqlite3');
    const remote = createServer(async (request, response) => {
      if (request.headers.authorization !== 'Bearer test-secret') {
        response.writeHead(401).end();
        return;
      }
      const files = {
        '/data': json,
        '/data.parquet': parquet,
        '/data.xlsx': join(root, 'tests/fixtures/销售 数据.xlsx'),
      };
      const file = files[new URL(request.url, 'http://localhost').pathname];
      if (!file) {
        response.writeHead(404).end();
        return;
      }
      response.end(await readFile(file));
    });
    try {
      await writeFile(unrelated, 'DUMMY_PRIVATE_CONTENT');
      await writeFile(json, JSON.stringify([{ value: 1 }, { value: 2 }]));
      const database = new DatabaseSync(sqlite);
      try {
        database.exec('CREATE TABLE sales (value INTEGER); INSERT INTO sales VALUES (1), (2)');
      } finally {
        database.close();
      }
      const instance = await DuckDBInstance.create(':memory:');
      const duckdb = await instance.connect();
      try {
        await duckdb.run(
          `COPY (SELECT value FROM (VALUES (1), (2)) t(value)) TO '${parquet.replaceAll(
            "'",
            "''",
          )}' (FORMAT PARQUET)`,
        );
      } finally {
        duckdb.closeSync();
        instance.closeSync();
      }
      remote.listen(0, '127.0.0.1');
      await once(remote, 'listening');
      const origin = `http://127.0.0.1:${remote.address().port}`;
      const config = join(directory, 'source.json');
      await writeFile(
        config,
        JSON.stringify({ type: 'json', options: { data: [{ value: 1 }, { value: 2 }] } }),
        { mode: 0o600 },
      );
      const csv = join(directory, 'extensionless');
      await writeFile(csv, 'value;category\n1;A\n2;B');
      const inputs = [
        { path: json },
        { path: parquet },
        { path: sqlite },
        { config: { type: 'json', options: { data: [{ value: 1 }, { value: 2 }] } } },
        { config: { type: 'csv', options: { csv: 'value\n1\n2' } } },
        { config: { type: 'csv-file', options: { path: csv, options: { delim: ';' } } } },
        { path: `@${config}` },
        {
          config: {
            type: 'json-file',
            options: {
              path: `${origin}/data?token=signed-secret`,
              headers: { Authorization: 'Bearer test-secret' },
            },
          },
        },
        {
          config: {
            type: 'parquet',
            options: {
              path: `${origin}/data.parquet`,
              headers: { Authorization: 'Bearer test-secret' },
            },
          },
        },
      ];
      for (const input of inputs) {
        const { datasetId } = await call(client, 'ava_source', input);
        let workspace;
        try {
          const schema = await call(client, 'ava_schema', { datasetId });
          const table = schema.models[0].tableReference.table.replaceAll('"', '""');
          const result = await call(client, 'ava_query', {
            datasetId,
            sql: `SELECT SUM(value) AS total FROM "${table}"`,
          });
          assert.equal(Number(result.data[0].total), 3);
          const storage = await call(client, 'ava_query', {
            datasetId,
            sql: "SELECT current_setting('temp_directory') AS path",
          });
          workspace = dirname(storage.data[0].path);
          assert.notEqual(workspace, directory);
          assert.equal((await stat(workspace)).mode & 0o777, 0o700);
          const denied = await client.callTool({
            name: 'ava_query',
            arguments: {
              datasetId,
              sql: `SELECT content FROM read_text('${unrelated.replaceAll("'", "''")}')`,
            },
          });
          assert.equal(denied.isError, true, 'Query must not read an unrelated local file');
          assert.match(denied.content[0].text, /disabled|permission|not allowed/i);
          if (input.config?.type === 'json-file') {
            const report = await call(client, 'ava_artifact', {
              output: join(directory, 'remote.html'),
              title: 'Remote',
              summary: 'Total is 3',
              sections: [{ question: 'Total?', conclusion: '3', queryId: result.queryId }],
            });
            const evidence = await readFile(report.dataOutput, 'utf8');
            assert(!evidence.includes(origin) && !evidence.includes('secret'));
            assert.equal(JSON.parse(evidence).queries[0].source, 'json-file');
          }
        } finally {
          await call(client, 'ava_dispose', { datasetId });
          if (workspace) await assert.rejects(access(workspace), { code: 'ENOENT' });
        }
      }
      const excel = await call(client, 'ava_source', {
        config: {
          type: 'excel',
          options: {
            path: `${origin}/data.xlsx`,
            headers: { Authorization: 'Bearer test-secret' },
          },
        },
      });
      const excelDenied = await client.callTool({
        name: 'ava_query',
        arguments: {
          ...excel,
          sql: `SELECT content FROM read_text('${unrelated.replaceAll("'", "''")}')`,
        },
      });
      assert.equal(excelDenied.isError, true);
      assert.match(excelDenied.content[0].text, /disabled|permission|not allowed/i);
      await call(client, 'ava_dispose', excel);
      const failed = await client.callTool({
        name: 'ava_source',
        arguments: {
          config: {
            type: 'json-file',
            options: {
              path: `${origin}/missing?token=private-token`,
              headers: { Authorization: 'Bearer test-secret' },
            },
          },
        },
      });
      assert.equal(failed.isError, true);
      assert(failed.content[0].text.includes('404'));
      assert(!failed.content[0].text.includes('private-token'));
    } finally {
      await client.close();
      await new Promise((resolve) => remote.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

// -----------------------------------------------------------------------------
// 完整链路：文件、查询、图表、报告与重启
// -----------------------------------------------------------------------------

test('SQLite isolation includes committed WAL data and keeps a stable snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-wal-'));
  const path = join(directory, 'live.sqlite');
  const writer = new DatabaseSync(path);
  const runtime = new Runtime();
  try {
    writer.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE sales(value INTEGER); ' +
        'INSERT INTO sales VALUES(1),(2)',
    );
    assert((await stat(path + '-wal')).size > 0);
    const source = await runtime.source(path);
    writer.exec('INSERT INTO sales VALUES(9)');
    const result = await runtime.query(source.datasetId, 'SELECT SUM(value) AS total FROM sales');
    assert.equal(Number(result.data[0].total), 3);
    assert.equal(writer.prepare('SELECT SUM(value) AS total FROM sales').get().total, 12);
  } finally {
    await runtime.close();
    writer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

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
      const chartInput = {
        spec: {
          chartType: 'bar',
          config: { type: 'bar', data: [{ category: 'Total', value: 67500 }] },
        },
        output,
      };
      await call(client, 'ava_viz', chartInput);
      assert((await stat(output)).size > 0);
      assert.equal((await stat(output)).mode & 0o777, 0o600);
      const chartHTML = await readFile(output);
      const duplicate = await client.callTool({
        name: 'ava_viz',
        arguments: chartInput,
      });
      assert.equal(duplicate.isError, true);
      assert.deepEqual(await readFile(output), chartHTML);
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
      const invalidChart = await client.callTool({
        name: 'ava_artifact',
        arguments: {
          output: join(directory, 'invalid-chart.html'),
          title: 'Invalid chart fields',
          summary: 'Keep query evidence.',
          sections: [
            {
              question: 'Q',
              conclusion: 'C',
              queryId: pie.queryId,
              chart: { chartType: 'scatter', config: {} },
            },
          ],
        },
      });
      assert.equal(invalidChart.isError, true);
      assert.match(invalidChart.content[0].text, /config\.data\.0\.x/);
      await assert.rejects(access(join(directory, 'invalid-chart.html')), /ENOENT/);
      await assert.rejects(access(join(directory, 'invalid-chart.json')), /ENOENT/);

      // 原对话的业务列名需要显式绑定，不能依赖渲染器猜测。
      const monthly = await call(client, 'ava_query', {
        datasetId: id,
        sql: 'SELECT month, COUNT(*) AS rows_cnt, SUM(revenue) AS total_revenue FROM data GROUP BY month ORDER BY month',
      });
      const mapped = await call(client, 'ava_artifact', {
        output: join(directory, 'mapped-chart.html'),
        title: 'Monthly revenue',
        summary: 'Verified',
        sections: [
          {
            question: 'Monthly totals?',
            conclusion: 'Verified',
            queryId: monthly.queryId,
            chart: { chartType: 'column', config: { axisYTitle: 'Revenue (USD)' } },
            chartFields: { category: 'month', value: 'total_revenue' },
          },
        ],
      });
      assert.deepEqual(mapped.chartErrors, []);
      const mappedData = JSON.parse(await readFile(mapped.dataOutput, 'utf8'));
      const mappedConfig = JSON.parse(
        mappedData.charts[0].html.match(/const visConfig = (.*);/)[1],
      );
      assert.deepEqual(mappedConfig.data, [
        { category: '2025-01', value: 30000 },
        { category: '2025-02', value: 37500 },
      ]);
      assert.deepEqual(mappedData.queries[0].result.data, monthly.data);

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
      const storage = await call(client, 'ava_query', {
        datasetId: id,
        sql: "SELECT current_setting('temp_directory') AS path",
      });
      await client.close();

      // -----------------------------------------------------------------------------
      // 断开连接后清理会话，重启后拒绝旧标识
      // -----------------------------------------------------------------------------

      // The transport closes the parent; its idle AVA session must be reaped.
      const socketDirectory = dirname(storage.data[0].path);
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
