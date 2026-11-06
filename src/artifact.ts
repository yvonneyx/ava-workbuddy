import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod/v4';
import { outputPath } from './ava.js';
import type { ChartSpec, QueryResult } from './contracts.js';

const text = z.string().trim().min(1).max(20000);
const queryId = z.string().min(1).max(100).describe('queryId returned by ava_query in this connection');
export const artifactInput = z.object({
  output: z.string().describe('Absolute path to a NEW .html file; parent directory must exist. A matching .json evidence file is also created; neither file may already exist'),
  title: text.max(200),
  summary: text,
  metrics: z.array(z.object({
    label: text.max(100), queryId, field: text.max(200),
    rowIndex: z.number().int().min(0).default(0), unit: z.string().max(40).optional(),
  }).strict()).max(6).default([]),
  sections: z.array(z.object({
    question: text.max(500), conclusion: text, queryId,
    chart: z.object({
      type: z.enum(['bar', 'column', 'line']),
      categoryField: text.max(200), valueField: text.max(200),
      categoryLabel: text.max(100).optional(), valueLabel: text.max(100).optional(),
    }).strict().optional(),
  }).strict()).min(1).max(16),
  definitions: z.array(text.max(1000)).max(20).default([]),
  limitations: z.array(text.max(1000)).max(20).default([]),
}).strict();

export type ArtifactInput = z.input<typeof artifactInput>;
export interface QueryEvidence {
  queryId: string;
  datasetId: string;
  source: string;
  sql: string;
  executedAt: string;
  result: QueryResult;
}
type RenderChart = (spec: ChartSpec, output: string) => Promise<{ output: string }>;
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function field(evidence: QueryEvidence, name: string) {
  if (!evidence.result.schema.some((column) => column.name === name)) throw new Error(`Unknown result field: ${name}`);
}

function chartSpec(chart: NonNullable<z.output<typeof artifactInput>['sections'][number]['chart']>, evidence: QueryEvidence): ChartSpec {
  if (evidence.result.truncated) throw new Error('查询结果已截断，暂不绘图；请先获取完整的聚合结果。');
  field(evidence, chart.categoryField); field(evidence, chart.valueField);
  const data = evidence.result.data.map((row) => {
    const raw = row[chart.valueField];
    if ((typeof raw !== 'number' && typeof raw !== 'string') || String(raw).trim() === '' || !Number.isFinite(Number(raw))) {
      throw new Error(`字段 ${chart.valueField} 含非数值或空值，请先在 SQL 中明确处理。`);
    }
    const category = row[chart.categoryField];
    if (category === null || category === undefined) throw new Error(`字段 ${chart.categoryField} 含空值，请先处理。`);
    return { [chart.type === 'line' ? 'time' : 'category']: String(category), value: Number(raw) };
  });
  if (!data.length) throw new Error('查询没有返回数据，暂不绘图。');
  return { chartType: chart.type, config: {
    data,
    axisXTitle: chart.categoryLabel ?? chart.categoryField,
    axisYTitle: chart.valueLabel ?? chart.valueField,
  } };
}

export async function createArtifact(input: ArtifactInput, history: ReadonlyMap<string, QueryEvidence>, renderChart: RenderChart) {
  const report = artifactInput.parse(input);
  outputPath(report.output);
  const evidence = new Map<string, QueryEvidence>();
  const get = (id: string) => {
    const query = evidence.get(id) ?? history.get(id);
    if (!query) throw new Error(`Unknown or expired queryId: ${id}. Run ava_query in this connection again.`);
    evidence.set(id, query);
    return query;
  };
  for (const section of report.sections) get(section.queryId);
  for (const metric of report.metrics) {
    const query = get(metric.queryId); field(query, metric.field);
    const row = query.result.data[metric.rowIndex];
    if (!row) throw new Error(`Metric rowIndex is outside query result: ${metric.rowIndex}`);
    const value = row[metric.field];
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) {
      throw new Error(`Metric field must contain a finite number: ${metric.field}`);
    }
  }
  const chartErrors: { section: number; message: string }[] = [];
  const charts: { section: number; html: string }[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-artifact-'));
  try {
    for (const [index, section] of report.sections.entries()) {
      if (!section.chart) continue;
      try {
        const spec = chartSpec(section.chart, get(section.queryId));
        const rendered = await renderChart(spec, join(directory, `chart-${index}.html`));
        charts.push({ section: index + 1, html: await readFile(rendered.output, 'utf8') });
      } catch (error) {
        chartErrors.push({ section: index + 1, message: error instanceof Error ? error.message : String(error) });
      }
    }
    // The template is fixed. Only this JSON data slot changes between reports.
    const { output, ...fields } = report;
    const payload = { ...fields, generatedAt: new Date().toISOString(), queries: [...evidence.values()], charts, chartErrors };
    const template = await readFile(new URL('../templates/artifact.html', import.meta.url), 'utf8');
    const slot = '<!-- ARTIFACT_DATA -->';
    if (template.split(slot).length !== 2) throw new Error('Artifact template must contain exactly one ARTIFACT_DATA slot.');
    const html = template.replace(slot, () => `<script id="artifact-data" type="application/json">${json(payload)}</script>`);
    const dataOutput = output.slice(0, -extname(output).length) + '.json';
    // Reserve both new destinations; never overwrite existing report data.
    const htmlFile = await open(output, 'wx', 0o600);
    let dataFile;
    try {
      dataFile = await open(dataOutput, 'wx', 0o600);
      await htmlFile.writeFile(html);
      await dataFile.writeFile(JSON.stringify(payload, null, 2));
    } catch (error) {
      await rm(output);
      if (dataFile) await rm(dataOutput);
      throw error;
    } finally { await htmlFile.close(); await dataFile?.close(); }
    return { output, dataOutput, sectionCount: report.sections.length, queryCount: evidence.size,
      htmlGenerated: true, chartPreviewVerified: false, chartErrors };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
