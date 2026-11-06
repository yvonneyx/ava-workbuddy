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
            chart: artifactChartSpec
              .optional()
              .describe(
                'Native AVA chart; query rows must match the native fields for this chartType. ' +
                  'Use chartFields to bind existing result columns; otherwise rows supply config.data unchanged. ' +
                  'Do not supply config.data, categories, series or percent inline. ' +
                  'For example, a column chart can use a query returning ' +
                  'month AS category, CAST(SUM(revenue) AS DOUBLE) AS value ' +
                  'grouped and ordered by month, with chart={chartType:"column", ' +
                  'config:{axisYTitle:"Revenue (USD)"}}.',
              ),
            chartFields: z
              .record(z.string(), text.max(200))
              .optional()
              .describe(
                'Explicit native chart field -> exact query column mapping, e.g. ' +
                  '{category:"month",value:"total_revenue"} for column/bar/pie; ' +
                  '{time:"month",value:"total_revenue"} for line/area. ' +
                  'Only these fields are projected into chart rows; saved evidence is unchanged. ' +
                  'No guessing or numeric conversion. Cannot combine with chartConfigField.',
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

function bindChart(
  section: z.output<typeof artifactInput>['sections'][number],
  evidence: QueryEvidence,
): ChartSpec {
  if (evidence.result.truncated) {
    throw new Error('查询结果已截断，暂不绘图；请先获取完整的聚合结果。');
  }
  // 显式投影图表字段，保留证据的原始列名与数值；不猜测字段或转换单位。
  const chart = section.chart!;
  for (const key of ['data', 'categories', 'series', 'percent']) {
    if (Object.hasOwn(chart.config, key)) {
      throw new Error(`config.${key} must come from query evidence, not inline chart data.`);
    }
  }
  if (!evidence.result.data.length) {
    throw new Error('查询没有返回数据，暂不绘图。');
  }
  let bound: Record<string, unknown> = { data: evidence.result.data };
  if (section.chartFields !== undefined) {
    if (section.chartConfigField !== undefined) {
      throw new Error('Use either chartFields or chartConfigField, not both.');
    }
    const fields = Object.entries(section.chartFields);
    if (!fields.length) {
      throw new Error('chartFields must map at least one native chart field to a query column.');
    }
    fields.forEach(([, source]) => field(evidence, source));
    bound = {
      data: evidence.result.data.map((row) =>
        Object.fromEntries(fields.map(([native, source]) => [native, row[source]])),
      ),
    };
  }
  if (section.chartConfigField !== undefined) {
    field(evidence, section.chartConfigField);
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
        'Bind native fields with chartFields or SQL aliases; numeric values must be numbers. ' +
        'Use chartConfigField for non-row data.',
    );
  }
  return parsed.data;
}

// -----------------------------------------------------------------------------
// 报告生成
// -----------------------------------------------------------------------------

export async function createArtifact(
  input: ArtifactInput,
  history: ReadonlyMap<string, QueryEvidence>,
  renderChart: RenderChart,
) {
  const report = artifactInput.parse(input);
  outputPath(report.output);

  // -----------------------------------------------------------------------------
  // 收集并校验证据
  // -----------------------------------------------------------------------------

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

  // -----------------------------------------------------------------------------
  // 渲染图表；单图失败时保留表格与 SQL
  // -----------------------------------------------------------------------------

  const chartErrors: { section: number; message: string }[] = [];
  const charts: { section: number; html: string }[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-artifact-'));
  try {
    for (const [index, section] of report.sections.entries()) {
      if (!section.chart) {
        continue;
      }
      try {
        const spec = bindChart(section, get(section.queryId));
        const rendered = await renderChart(spec, join(directory, `chart-${index}.html`));
        charts.push({ section: index + 1, html: await readFile(rendered.output, 'utf8') });
      } catch (error) {
        chartErrors.push({
          section: index + 1,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // -----------------------------------------------------------------------------
    // 固定模板与数据绑定
    // -----------------------------------------------------------------------------

    // 只替换一个 JSON 数据槽；正文由浏览器通过文本节点绑定。
    const { output, ...fields } = report;
    const payload = {
      ...fields,
      generatedAt: new Date().toISOString(),
      queries: [...evidence.values()],
      charts,
      chartErrors,
    };
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
    return {
      output,
      dataOutput,
      sectionCount: report.sections.length,
      queryCount: evidence.size,
      htmlGenerated: true,
      chartPreviewVerified: false,
      chartErrors,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
