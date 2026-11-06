import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { root } from '../lib/metadata.js';

async function connect() {
  const client = new Client({ name: 'ava-workbuddy-integration-test', version: '0.1.0' });
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'lib/cli.js'), 'serve'], env, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', (chunk) => { stderr += chunk; });
  await client.connect(transport);
  return { client, stderr: () => stderr };
}
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, { timeout: 120000 });
  assert(!response.isError, response.content?.map((item) => item.text).join('\n'));
  return response.structuredContent ?? JSON.parse(response.content[0].text);
}

test('MCP first use, CSV/XLSX, read-only queries, charts, errors, and restart', { timeout: 180000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-集成 '));
  const connection = await connect(); const client = connection.client;
  let id;
  try {
    const tools = await client.listTools(); assert.equal(tools.tools.length, 9);
    assert.equal((await call(client, 'ava_check')).avaVersion, '4.0.0');
    const file = join(directory, '销售 $(literal) 数据.csv');
    await copyFile(join(root, 'examples/sales.csv'), file);
    const original = await readFile(file);
    id = (await call(client, 'ava_source', { path: file })).datasetId;
    const schema = await call(client, 'ava_schema', { datasetId: id });
    assert.equal(schema.language.fence, 'sql');
    assert(schema.models.some((model) => model.tableReference?.table === 'data'));
    const result = await call(client, 'ava_query', { datasetId: id, sql: 'SELECT SUM(revenue) AS revenue FROM data' });
    assert.equal(Number(result.data[0].revenue), 67500);
    const report = await call(client, 'ava_artifact', { output: join(directory, 'artifact.html'), title: '集成测试报告', summary: '核对两个月收入合计。',
      metrics: [{ label: '合计', queryId: result.queryId, field: 'revenue', unit: '美元' }],
      sections: [{ question: '总收入是多少？', conclusion: '合计 67,500 美元。', queryId: result.queryId }] });
    const reportHTML = await readFile(report.output, 'utf8');
    assert(reportHTML.includes('67,500') && reportHTML.includes('SELECT SUM(revenue)'));
    const truncated = await call(client, 'ava_query', { datasetId: id, sql: 'SELECT * FROM data', maxRows: 1 });
    assert.equal(truncated.truncated, true);
    const mutation = await client.callTool({ name: 'ava_query', arguments: { datasetId: id, sql: 'DELETE FROM data' } });
    assert.equal(mutation.isError, true); assert.deepEqual(await readFile(file), original);
    const semantic = { description: 'Revenue is in USD; compare calendar-month totals.' };
    await call(client, 'ava_semantic', { datasetId: id, definition: semantic });
    assert.deepEqual(await call(client, 'ava_semantic', { datasetId: id }), semantic);
    const output = join(directory, 'chart.html');
    await call(client, 'ava_viz', { spec: { chartType: 'bar', config: { type: 'bar', data: [{ category: 'Total', value: 67500 }] } }, output });
    assert((await stat(output)).size > 0);
    const duplicate = await client.callTool({ name: 'ava_viz', arguments: { spec: { chartType: 'bar', config: {} }, output } });
    assert.equal(duplicate.isError, true);
    const beforeMissing = await readFile(output);
    const missing = await client.callTool({ name: 'ava_source', arguments: { path: join(directory, 'missing.csv') } });
    assert.equal(missing.isError, true); assert.deepEqual(await readFile(output), beforeMissing);
    const demo = await call(client, 'ava_demo', { outputDirectory: join(directory, 'demo') });
    assert.equal(demo.change, 7500); assert.equal(demo.chartPreviewVerified, false);
    assert.deepEqual(demo.artifactChartErrors, []);
    assert((await readFile(demo.artifact, 'utf8')).includes('收入变化分析'));
    const artifactData = JSON.parse(await readFile(demo.artifactData, 'utf8'));
    assert.equal(artifactData.sections.length, 4);
    assert.equal(demo.queryCount, 4);
    assert.equal(new Set(artifactData.sections.map(section => section.queryId)).size, 4);
    assert.equal(artifactData.queries.length, 4);
    const evidence = new Map(artifactData.queries.map(query => [query.queryId, query]));
    assert.equal(Number(evidence.get(artifactData.sections[0].queryId).result.data[0].revenue), 30000);
    assert.equal(evidence.get(artifactData.sections[1].queryId).result.data.length, 4);
    assert.equal(Number(evidence.get(artifactData.sections[2].queryId).result.data[0].revenue), 6000);
    assert.equal(Number(evidence.get(artifactData.sections[3].queryId).result.data[0].reconciliation_difference), 0);
    assert.equal(artifactData.charts.length, 3);
    assert.equal(evidence.get(artifactData.sections[1].queryId).result.data.reduce((sum, row) => sum + Number(row.change), 0), 7500);
    assert.deepEqual((await readdir(demo.outputDirectory)).sort(), ['artifact.html', 'artifact.json', 'query.sql', 'result.json', 'sales.csv']);
    const xlsx = (await call(client, 'ava_source', { path: join(root, 'test/fixtures/销售 数据.xlsx') })).datasetId;
    const excelSchema = await call(client, 'ava_schema', { datasetId: xlsx });
    const table = excelSchema.models[0].tableReference.table;
    const excel = await call(client, 'ava_query', { datasetId: xlsx, sql: `SELECT SUM(revenue) AS revenue FROM "${table.replaceAll('"', '""')}"` });
    assert.equal(Number(excel.data[0].revenue), 67500);
    await call(client, 'ava_dispose', { datasetId: xlsx });
    await call(client, 'ava_dispose', { datasetId: id });
    const expired = await client.callTool({ name: 'ava_schema', arguments: { datasetId: id } });
    assert.equal(expired.isError, true);
    id = (await call(client, 'ava_source', { path: file })).datasetId;
    await client.close();
    // The transport closes the parent; its idle AVA session must be reaped.
    const socketDirectory = join(tmpdir(), `ava-${id}`);
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await access(socketDirectory); }
      catch { break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await assert.rejects(access(socketDirectory));
    const restarted = await connect();
    try {
      const stale = await restarted.client.callTool({ name: 'ava_schema', arguments: { datasetId: id } });
      assert.equal(stale.isError, true);
      const reloaded = (await call(restarted.client, 'ava_source', { path: file })).datasetId;
      await call(restarted.client, 'ava_dispose', { datasetId: reloaded });
    } finally { await restarted.client.close(); }
    assert(!connection.stderr().includes('Error:'), connection.stderr());
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});
