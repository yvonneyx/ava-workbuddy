import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVA } from '@antv/ava';
import { workbuddyCliModel } from './workbuddy-cli-model.mjs';

if (!process.argv[2] || !process.argv[3]) {
  throw new Error('Usage: node scripts/workbuddy-cli-analyze.mjs <new-output-directory> <model-id>');
}
const directory = resolve(process.argv[2]);
await mkdir(directory);
let modelCalls = 0;
const model = workbuddyCliModel({ cwd: directory, model: process.argv[3],
  onCall: async ({ index, ...data }) => {
    modelCalls++;
    await writeFile(join(directory, `sdk-model-call-${index}.json`), JSON.stringify(data, null, 2), { mode: 0o600 });
  },
});
const ava = new AVA({ llm: { model, maxRetries: 0 }, engine: { type: 'duckdb' } });
const question = '按月份汇总 2025 年 1 月和 2 月的收入，输出两列 month 和 revenue，按月份升序排列，并说明两个月收入增加了多少、环比增长多少。revenue 的单位为美元。这是模拟数据，不要推断增长原因。';
try {
  await ava.source({ type: 'csv-file', options: { path: fileURLToPath(new URL('../examples/sales.csv', import.meta.url)) } });
  const schema = await ava.schema();
  await writeFile(join(directory, 'sdk-schema.json'), JSON.stringify(schema, null, 2), { mode: 0o600 });
  const result = await ava.analyze(question, { strategy: { type: 'direct', maxRetries: 0 } });
  await writeFile(join(directory, 'sdk-analysis.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  assert(!result.truncated, 'Unexpected truncated analysis.');
  assert.equal(result.data.length, 2);
  assert.equal(Number(result.data.find(row => row.month === '2025-01')?.revenue), 30000);
  assert.equal(Number(result.data.find(row => row.month === '2025-02')?.revenue), 37500);
  assert(result.sql && result.text, 'Expected executed SQL and a model-generated conclusion.');
  assert.equal(modelCalls, 2, 'Expected SQL generation and result summary model calls.');
  await writeFile(join(directory, 'sdk-verification.json'), JSON.stringify({ sdkAnalyzeVerified: true, question, modelCalls,
    expectedRows: [{ month: '2025-01', revenue: 30000 }, { month: '2025-02', revenue: 37500 }], increase: 7500, growthRate: 0.25,
  }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ sdkAnalyzeVerified: true, modelCalls, data: result.data, sql: result.sql, text: result.text }));
} finally { await ava.dispose(); }
