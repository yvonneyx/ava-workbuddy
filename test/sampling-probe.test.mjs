import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { generateText } from 'ai';
import { createSamplingProbe, marker } from '../scripts/sampling-probe.mjs';
import { samplingModel } from '../scripts/sampling-model.mjs';

test('probe records capabilities and refuses SDK calls without a real successful probe', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sampling-probe-test-'));
  const { server } = createSamplingProbe(directory);
  const client = new Client({ name: 'fixture-client', version: 'test' }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(b), client.connect(a)]);
    const capabilities = await client.callTool({ name: 'ava_sampling_capabilities', arguments: {} });
    assert.equal(capabilities.structuredContent.client.name, 'fixture-client');
    assert.equal((await client.callTool({ name: 'ava_sampling_probe', arguments: {} })).isError, true);
    assert.equal((await client.callTool({ name: 'ava_sdk_analyze_demo', arguments: {} })).isError, true);
    assert(!(await readFile(join(directory, 'events.jsonl'), 'utf8')).includes('sampling-request'));
  } finally { await client.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test('Sampling model adapter works through the actual AI SDK generateText interface', async () => {
  let params;
  const model = samplingModel(async request => { params = request; return { role: 'assistant', content: { type: 'text', text: marker }, model: 'fixture-model', stopReason: 'endTurn' }; });
  const result = await generateText({ model, system: 'Text only.', prompt: 'Connectivity test.', maxRetries: 0 });
  assert.equal(result.text, marker);
  assert.equal(params.includeContext, 'none');
  assert.equal(params.systemPrompt, 'Text only.');
  assert.equal(params.messages[0].content.text, 'Connectivity test.');
});
