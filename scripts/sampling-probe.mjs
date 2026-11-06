import assert from 'node:assert/strict';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { AVA } from '@antv/ava';
import { samplingModel } from './sampling-model.mjs';

export const marker = 'AVA_SAMPLING_OK_20261106';

export function createSamplingProbe(directory) {
  const server = new McpServer({ name: 'ava-sampling-probe', version: '0.0.1' });
  let passed = false;
  let callIndex = 0;
  const log = async (event, data) => {
    await mkdir(directory, { recursive: true });
    await appendFile(join(directory, 'events.jsonl'), JSON.stringify({ time: new Date().toISOString(), pid: process.pid, event, ...data }) + '\n', { mode: 0o600 });
  };
  const identity = () => ({ client: server.server.getClientVersion(), protocolVersion: server.server.getNegotiatedProtocolVersion(), capabilities: server.server.getClientCapabilities() });
  const request = async params => {
    const index = ++callIndex;
    await log('sampling-request', { index, params });
    try {
      const response = await server.server.createMessage(params, { timeout: 120000 });
      await log('sampling-response', { index, response });
      return response;
    } catch (error) {
      await log('sampling-error', { index, message: error.message, code: error.code });
      throw error;
    }
  };
  const register = (name, description, action) => server.registerTool(name, {
    description, inputSchema: z.object({}).strict(), annotations: { destructiveHint: false, openWorldHint: false },
  }, async () => {
    await log('tool-start', { name, ...identity() });
    try {
      const result = await action();
      await log('tool-result', { name, result });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      await log('tool-error', { name, message: error.message, code: error.code });
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
  register('ava_sampling_capabilities', 'Inspect the ACTUAL WorkBuddy MCP handshake. No model call, no credential access. Saves the advertised client capabilities and version.', async () => {
    const result = identity();
    await writeFile(join(directory, 'handshake.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  });
  register('ava_sampling_probe', 'Request one real host-model Sampling response. Only a fixed non-sensitive test prompt is sent. May require WorkBuddy Sampling approval. Run capabilities first.', async () => {
    if (!server.server.getClientCapabilities()?.sampling) throw new Error('Host did not advertise sampling capability; no model request sent.');
    const response = await request({ messages: [{ role: 'user', content: { type: 'text', text: `This is a connectivity test. Reply with exactly ${marker} and nothing else.` } }], maxTokens: 128, includeContext: 'none' });
    const parts = Array.isArray(response.content) ? response.content : [response.content];
    const text = parts.filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
    passed = response.role === 'assistant' && text.length > 0 && parts.every(part => part.type === 'text');
    const result = { samplingUsable: passed, markerMatched: text === marker, model: response.model, text, stopReason: response.stopReason };
    await writeFile(join(directory, 'probe-result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  });
  register('ava_sdk_analyze_demo', 'ONLY after a successful real ava_sampling_probe in this connection: run AVA SDK analyze on the bundled 8-row synthetic sales CSV using host Sampling for SQL generation and summary. No API key is read. Verify Jan=30000 and Feb=37500, then dispose the SDK engine.', async () => {
    if (!passed) throw new Error('Run a successful real ava_sampling_probe in this connection before SDK analyze.');
    const ava = new AVA({ llm: { model: samplingModel(request), maxRetries: 0 }, engine: { type: 'duckdb' } });
    try {
      await ava.source({ type: 'csv-file', options: { path: fileURLToPath(new URL('../examples/sales.csv', import.meta.url)) } });
      const schema = await ava.schema();
      await log('sdk-schema', { schema });
      const question = '按月份汇总 2025 年 1 月和 2 月的收入，输出两列 month 和 revenue，按月份升序排列，并说明两个月收入增加了多少、环比增长多少。revenue 的单位为美元。这是模拟数据，不要推断增长原因。';
      const result = await ava.analyze(question, { strategy: { type: 'direct', maxRetries: 0 } });
      await writeFile(join(directory, 'sdk-analysis.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
      assert(!result.truncated, 'SDK analysis returned a truncated result.');
      assert.equal(result.data.length, 2, 'Expected two monthly rows.');
      assert.equal(Number(result.data.find(row => row.month === '2025-01')?.revenue), 30000);
      assert.equal(Number(result.data.find(row => row.month === '2025-02')?.revenue), 37500);
      assert(result.sql && result.text, 'Expected executed SQL and a model-generated summary.');
      return { sdkAnalyzeVerified: true, question, result, output: join(directory, 'sdk-analysis.json'), modelCalls: callIndex };
    } finally { await ava.dispose(); }
  });
  server.server.oninitialized = () => { void log('initialized', identity()).catch(error => process.stderr.write(error.message + '\n')); };
  return { server };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? fileURLToPath(new URL('../../workbuddy-sampling-probe-20261106', import.meta.url)));
  await mkdir(directory, { recursive: true });
  const probe = createSamplingProbe(directory);
  await probe.server.connect(new StdioServerTransport());
}
