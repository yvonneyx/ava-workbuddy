import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// -----------------------------------------------------------------------------
// 在解包后的专家中验证原生 CLI、持久证据与追问报告
// -----------------------------------------------------------------------------

export async function runSkillDemo(skill, output, cli) {
  await mkdir(output);
  const wrapper = join(output, 'ava');
  await writeFile(
    wrapper,
    `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';\n` +
      `const result = spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], { stdio: 'inherit' });\n` +
      `process.exitCode = result.status ?? 1;\n`,
  );
  await chmod(wrapper, 0o700);
  const env = { ...process.env, AVA_CLI: wrapper };
  const invoke = (entry, args) =>
    JSON.parse(
      execFileSync(process.execPath, [realpathSync(entry), ...args], {
        env,
        encoding: 'utf8',
        timeout: 90000,
      }),
    );
  const ava = (...args) => invoke(cli, args);
  const report = (...args) => invoke(join(skill, 'scripts/report.mjs'), args);
  const fixture = fileURLToPath(new URL('./fixtures/sales.csv', import.meta.url));
  const { datasetId } = ava('source', fixture);
  let disposed = false;
  try {
    assert(ava('schema', datasetId).models.some((model) => model.tableReference.table === 'data'));
    assert(ava('profile', datasetId, '--metrics', 'row_count,null_count'));
    const semantic = join(output, 'semantic.json');
    await writeFile(semantic, JSON.stringify({ description: 'Synthetic monthly revenue in USD.' }));
    ava('semantic', datasetId, '--file', semantic);
    assert.equal(ava('semantic', datasetId).description, 'Synthetic monthly revenue in USD.');

    const evidence = join(output, 'evidence');
    const query = async (name, sql) => {
      const dsl = join(output, `${name}.sql`);
      await writeFile(dsl, sql);
      return report(
        'query',
        datasetId,
        '--dsl',
        dsl,
        '--source',
        'sales.csv',
        '--evidence',
        evidence,
      );
    };
    const totals = await query(
      'monthly',
      'SELECT month, CAST(SUM(revenue) AS DOUBLE) AS revenue FROM data GROUP BY month ORDER BY month',
    );
    assert.deepEqual(
      totals.data.map((row) => row.revenue),
      [30000, 37500],
    );
    const spec = join(output, 'report-spec.json');
    const monthly = {
      id: 'monthly',
      question: '每月收入？',
      conclusion: '收入从 30000 增至 37500 美元。',
      queryId: totals.queryId,
      chartFields: { category: 'month', value: 'revenue' },
      chart: { chartType: 'column', config: { axisYTitle: '收入（美元）' } },
    };
    await writeFile(
      spec,
      JSON.stringify({
        title: 'Skill 收入分析',
        summary: '收入增加 7500 美元。',
        metrics: [
          {
            label: '2 月收入',
            queryId: totals.queryId,
            field: 'revenue',
            rowIndex: 1,
            unit: '美元',
          },
        ],
        sections: [monthly],
      }),
    );
    const first = report(
      'render',
      '--evidence',
      evidence,
      '--spec',
      spec,
      '--output',
      join(output, 'report-v1.html'),
    );
    assert.equal(first.chartCount, 1);
    assert.deepEqual(first.chartErrors, []);

    const contributions = await query(
      'contributions',
      await readFile(new URL('./fixtures/revenue-change.sql', import.meta.url), 'utf8'),
    );
    assert.equal(
      contributions.data.reduce((sum, row) => sum + Number(row.value), 0),
      7500,
    );
    ava('dispose', datasetId);
    disposed = true;
    assert.equal(report('index', '--evidence', evidence).length, 2);
    await writeFile(
      spec,
      JSON.stringify({
        sections: [
          {
            id: 'contributions',
            question: '产品贡献能否核对？',
            conclusion: '产品贡献合计为 7500 美元。',
            queryId: contributions.queryId,
            chart: { chartType: 'bar', config: {} },
          },
        ],
      }),
    );
    const second = report(
      'render',
      '--evidence',
      evidence,
      '--spec',
      spec,
      '--previous',
      first.dataOutput,
      '--output',
      join(output, 'report-v2.html'),
    );
    assert.equal(second.sectionCount, 2);
    assert.equal(second.queryCount, 2);
    assert.equal(second.chartCount, 2);
    assert.deepEqual(second.chartErrors, []);
    const saved = JSON.parse(await readFile(second.dataOutput, 'utf8'));
    assert.deepEqual(saved.sections[0], monthly);
    const metric = saved.metrics[0];
    const metricQuery = saved.queries.find((query) => query.queryId === metric.queryId);
    assert.equal(metricQuery.result.data[metric.rowIndex][metric.field], 37500);
    for (const path of [
      totals.evidenceOutput,
      first.output,
      first.dataOutput,
      second.output,
      second.dataOutput,
    ]) {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
    assert((await readFile(second.output, 'utf8')).includes('data:image/svg+xml;base64,'));
    return { ...second, sessionDisposedBeforeFollowUp: true };
  } finally {
    if (!disposed) ava('dispose', datasetId);
  }
}
