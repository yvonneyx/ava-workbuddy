import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod/v4';
import { outputPath } from './ava.js';
import { artifactChartSpec, chartSpec, type ChartSpec, type QueryResult } from './contracts.js';

// -----------------------------------------------------------------------------
// 报告输入协议
// -----------------------------------------------------------------------------

const text = z.string().trim().min(1).max(20000);
const queryId = z
  .string()
  .min(1)
  .max(100)
  .describe('queryId returned by ava_query in this connection');
export const artifactInput = z
  .object({
    output: z
      .string()
      .describe(
        'Absolute path to a NEW .html file; parent directory must exist. A matching ' +
          '.json evidence file is also created; neither file may already exist',
      ),
    title: text.max(200).describe('Report title'),
    summary: text.describe('Main finding supported by the referenced query results'),
    metrics: z
      .array(
        z
          .object({
            label: text.max(100),
            queryId,
            field: text.max(200).describe('Exact result column containing a finite numeric value'),
            rowIndex: z.number().int().min(0).default(0).describe('Zero-based result row index'),
            unit: z
              .string()
              .max(40)
              .optional()
              .describe('Display unit; does not convert the value'),
          })
          .strict(),
      )
      .max(6)
      .default([]),
    sections: z
      .array(
        z
          .object({
            question: text.max(500).describe('Question answered by this section'),
            conclusion: text.describe("Finding supported by this section's query evidence"),
            queryId,
            chartFields: z
              .record(z.string(), text.max(200))
              .optional()
              .describe(
                'Bind the existing query BEFORE generating the report: native chart field -> ' +
                  'exact query column. Put this beside chart, not inside chart.config. Example: ' +
                  '{category:"month",value:"total_revenue"} for column/bar/pie; ' +
                  '{time:"month",value:"total_revenue"} for line/area. ' +
                  'Only these fields are projected into chart rows; saved evidence is unchanged. ' +
                  'Reuse the same queryId; do not rerun SQL just to rename columns. ' +
                  'Omit only if rows already have native fields. No guessing or numeric conversion. ' +
                  'Cannot combine with chartConfigField.',
              ),
            chart: artifactChartSpec
              .optional()
              .describe(
                'Chart type and display options only. Bind existing query columns with the ' +
                  'sibling chartFields, or use chartConfigField for non-row shapes. ' +
                  'Without either binding, rows must already have native fields for this chartType. ' +
                  'Never put data, categories, series or percent inline in config.',
              ),
            chartConfigField: text
              .max(200)
              .optional()
              .describe(
                'For non-row chart data: result column containing a native config OBJECT in ' +
                  'exactly one query row, not a JSON string. Its keys override chart.config. ' +
                  "Example histogram SQL: SELECT {'data': list(CAST(revenue AS DOUBLE))} " +
                  'AS chart_config FROM data',
              ),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    definitions: z
      .array(text.max(1000))
      .max(20)
      .default([])
      .describe('Confirmed metric definitions, scope and units applied in the queries'),
    limitations: z
      .array(text.max(1000))
      .max(20)
      .default([])
      .describe('Material data gaps and limits on the conclusions'),
  })
  .strict();

// -----------------------------------------------------------------------------
// 查询证据与原生图表绑定
// -----------------------------------------------------------------------------

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
const json = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
function field(evidence: QueryEvidence, name: string) {
  if (!evidence.result.schema.some((column) => column.name === name)) {
    throw new Error(`Unknown result field: ${name}`);
  }
}

type Section = z.output<typeof artifactInput>['sections'][number];
export interface ChartError {
  section: number;
  message: string;
}
interface ChartPlan {
  section: number;
  spec: ChartSpec;
}

function validateChartBinding(section: Section, evidence: QueryEvidence) {
  if (!section.chart) {
    if (section.chartFields !== undefined || section.chartConfigField !== undefined) {
      throw new Error('Chart bindings require chart.');
    }
    return;
  }
  for (const key of ['data', 'categories', 'series', 'percent']) {
    if (Object.hasOwn(section.chart.config, key)) {
      throw new Error(`config.${key} must come from query evidence, not inline chart data.`);
    }
  }
  if (section.chartFields !== undefined) {
    if (section.chartConfigField !== undefined) {
      throw new Error('Use either chartFields or chartConfigField, not both.');
    }
    const fields = Object.values(section.chartFields);
    if (!fields.length) {
      throw new Error('chartFields must map at least one native chart field to a query column.');
    }
    fields.forEach((name) => field(evidence, name));
  }
  if (section.chartConfigField !== undefined) {
    field(evidence, section.chartConfigField);
  }
}

function bindChart(section: Section, evidence: QueryEvidence): ChartSpec {
  // 参数已统一校验；这里只投影字段，不猜测字段、不转换数值或单位。
  const chart = section.chart!;
  let bound: Record<string, unknown> = { data: evidence.result.data };
  if (section.chartFields !== undefined) {
    const fields = Object.entries(section.chartFields);
    bound = {
      data: evidence.result.data.map((row) =>
        Object.fromEntries(fields.map(([native, source]) => [native, row[source]])),
      ),
    };
  }
  if (section.chartConfigField !== undefined) {
    if (evidence.result.data.length !== 1) {
      throw new Error('chartConfigField requires a single-row query result.');
    }
    bound = z
      .record(z.string(), z.unknown())
      .parse(evidence.result.data[0]![section.chartConfigField]);
  }
  const parsed = chartSpec.safeParse({
    chartType: chart.chartType,
    config: { ...chart.config, ...bound },
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(
      `Invalid ${chart.chartType} chart at ${issue.path.join('.')}: ${issue.message}. ` +
        'Set chartFields to map native fields to existing query columns; numeric values must be numbers. ' +
        'Use chartConfigField for non-row data.',
    );
  }
  return parsed.data;
}

// -----------------------------------------------------------------------------
// 参数与查询证据校验：纯函数，不渲染、不写文件
// -----------------------------------------------------------------------------

function prepareArtifact(input: ArtifactInput, history: ReadonlyMap<string, QueryEvidence>) {
  const report = artifactInput.parse(input);
  outputPath(report.output);

  const evidence = new Map<string, QueryEvidence>();
  // 先固定本次引用的快照，避免渲染期间查询历史淘汰影响当前报告。
  const get = (id: string) => {
    const query = evidence.get(id) ?? history.get(id);
    if (!query) {
      throw new Error(`Unknown or expired queryId: ${id}. Run ava_query in this connection again.`);
    }
    evidence.set(id, query);
    return query;
  };
  for (const section of report.sections) {
    get(section.queryId);
  }
  for (const metric of report.metrics) {
    const query = get(metric.queryId);
    field(query, metric.field);
    const row = query.result.data[metric.rowIndex];
    if (!row) {
      throw new Error(`Metric rowIndex is outside query result: ${metric.rowIndex}`);
    }
    const value = row[metric.field];
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      String(value).trim() === '' ||
      !Number.isFinite(Number(value))
    ) {
      throw new Error(`Metric field must contain a finite number: ${metric.field}`);
    }
  }

  const plans: ChartPlan[] = [];
  const chartErrors: ChartError[] = [];
  for (const [index, section] of report.sections.entries()) {
    const query = get(section.queryId);
    try {
      // 参数规则不随结果是否截断或为空而改变。
      validateChartBinding(section, query);
      if (!section.chart) continue;
      const spec = query.result.data.length ? bindChart(section, query) : undefined;
      if (query.result.truncated || !spec) {
        chartErrors.push({
          section: index + 1,
          message: query.result.truncated
            ? '查询结果已截断，暂不绘图；请先获取完整的聚合结果。'
            : '查询没有返回数据，暂不绘图。',
        });
        continue;
      }
      plans.push({ section: index + 1, spec });
    } catch (error) {
      throw new Error(
        `sections[${index}] (${section.queryId}): ${
          error instanceof Error ? error.message : String(error)
        } ` +
          `Available query columns: ${query.result.schema
            .map((column) => column.name)
            .join(', ')}. ` +
          'Fix the section binding and retry with the same queryId and output path. No output files were created.',
      );
    }
  }

  return { report, queries: [...evidence.values()], plans, chartErrors };
}

// -----------------------------------------------------------------------------
// 图表渲染：单图失败只影响该图，保留表格与 SQL
// -----------------------------------------------------------------------------

async function renderCharts(plans: ChartPlan[], renderChart: RenderChart) {
  const charts: { section: number; html: string }[] = [];
  const chartErrors: ChartError[] = [];
  if (!plans.length) return { charts, chartErrors };
  const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-artifact-'));
  try {
    for (const { section, spec } of plans) {
      try {
        const rendered = await renderChart(spec, join(directory, `chart-${section}.html`));
        charts.push({ section, html: await readFile(rendered.output, 'utf8') });
      } catch (error) {
        chartErrors.push({
          section,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { charts, chartErrors };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// 模板绑定与文件写入：独占创建，失败时仅回滚本次文件
// -----------------------------------------------------------------------------

async function writeArtifact(output: string, payload: unknown) {
  // 模板资源在生成时内嵌，报告离开仓库后仍可独立打开。
  const logo = await readFile(new URL('../public/icon.svg', import.meta.url));
  const template = (
    await readFile(new URL('../public/artifact.html', import.meta.url), 'utf8')
  ).replace('src="icon.svg"', () => `src="data:image/svg+xml;base64,${logo.toString('base64')}"`);
  const slot = '<!-- ARTIFACT_DATA -->';
  if (template.split(slot).length !== 2) {
    throw new Error('Artifact template must contain exactly one ARTIFACT_DATA slot.');
  }
  const html = template.replace(
    slot,
    () => `<script id="artifact-data" type="application/json">${json(payload)}</script>`,
  );
  const dataOutput = output.slice(0, -extname(output).length) + '.json';

  // -----------------------------------------------------------------------------
  // 写入报告与证据文件
  // -----------------------------------------------------------------------------

  // 用独占模式预留两个文件；任一步失败都只回滚本次新建的文件。
  const htmlFile = await open(output, 'wx', 0o600);
  let dataFile;
  try {
    dataFile = await open(dataOutput, 'wx', 0o600);
    await htmlFile.writeFile(html);
    await dataFile.writeFile(JSON.stringify(payload, null, 2));
  } catch (error) {
    await rm(output);
    if (dataFile) {
      await rm(dataOutput);
    }
    throw error;
  } finally {
    await htmlFile.close();
    await dataFile?.close();
  }
  return { output, dataOutput };
}

// -----------------------------------------------------------------------------
// 报告编排：校验与绑定 → 渲染 → 写入
// -----------------------------------------------------------------------------

export async function createArtifact(
  input: ArtifactInput,
  history: ReadonlyMap<string, QueryEvidence>,
  renderChart: RenderChart,
) {
  const { report, queries, plans, chartErrors: skipped } = prepareArtifact(input, history);
  const { charts, chartErrors: failures } = await renderCharts(plans, renderChart);
  const chartErrors = [...skipped, ...failures].sort((a, b) => a.section - b.section);
  const { output, ...fields } = report;
  const files = await writeArtifact(output, {
    ...fields,
    generatedAt: new Date().toISOString(),
    queries,
    charts,
    chartErrors,
  });
  return {
    ...files,
    sectionCount: report.sections.length,
    queryCount: queries.length,
    htmlGenerated: true,
    chartPreviewVerified: false,
    chartErrors,
  };
}
