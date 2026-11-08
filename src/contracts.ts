import { z } from 'zod/v4';

// -----------------------------------------------------------------------------
// 数据源输入；具体 options 由固定版本的 AVA 校验
// -----------------------------------------------------------------------------

export const fileSourceType = z.enum(['csv-file', 'json-file', 'parquet', 'excel', 'sqlite']);
export const sourceConfig = z
  .object({
    type: z.enum([
      ...fileSourceType.options,
      'csv',
      'json',
      'text',
      'mysql',
      'postgresql',
      'mongodb',
      'clickhouse',
      'supabase',
      'feishu-bitable',
    ]),
    options: z
      .record(z.string(), z.unknown())
      .describe(
        'Supported AVA options: file types require an absolute local path. ' +
          'HTTP(S) file sources and built-in SSH tunnels are temporarily disabled. ' +
          'csv-file/json-file accept nested options, ' +
          'excel accepts sheets. csv: {csv, options?}; json: {data: object[], options?}; ' +
          'text: {text}. mysql/postgresql: {host,database,port?,user?,password?}, ' +
          'postgresql also accepts schema. mongodb: {database,connection?} or host/port/user/password. ' +
          'clickhouse: {url or host,database,username?,password?,...native client options}; ' +
          'supabase: {accessToken,projectRef}; feishu-bitable: {official HTTPS url} or {appToken,tableId}, ' +
          'with optional appId/appSecret (otherwise resolved by AVA).',
      ),
  })
  .strict();

// -----------------------------------------------------------------------------
// AVA 响应与图表协议
// -----------------------------------------------------------------------------

export const sourceResult = z.object({ datasetId: z.string().regex(/^ds_[a-z0-9_-]+$/) });
export const schemaResult = z.looseObject({
  language: z.looseObject({ name: z.string(), fence: z.string() }),
  models: z.array(
    z.looseObject({
      name: z.string(),
      tableReference: z.looseObject({ table: z.string() }),
      columns: z.array(z.looseObject({ name: z.string(), type: z.string() })),
    }),
  ),
});
export const queryResult = z.looseObject({
  schema: z.array(z.object({ name: z.string(), type: z.string().optional() })),
  data: z.array(z.record(z.string(), z.unknown())),
  truncated: z.literal(true).optional(),
  truncatedBy: z.enum(['maxRows', 'maxResultBytes']).optional(),
  rowCount: z.number().optional(),
});
export const semanticResult = z.record(z.string(), z.unknown());
export const vizResult = z.object({ output: z.string() });
export const disposeResult = z.object({ datasetId: z.string(), disposed: z.literal(true) });

// -----------------------------------------------------------------------------
// 原生图表字段：MCP 参数说明与最终渲染使用同一份协议
// -----------------------------------------------------------------------------

const label = z.union([z.string(), z.number()]);
const number = z.number().describe('Finite JSON number; cast numeric strings in the query');
const group = label.optional();
const categoryValue = z.looseObject({ category: label, value: number, group });
const timeValue = z.looseObject({ time: label, value: number, group });
const observations = z.array(categoryValue).min(1);
const treeNode = z.looseObject({
  name: label,
  value: number.nonnegative().optional(),
  get children(): z.ZodOptional<z.ZodArray<typeof treeNode>> {
    return z.array(treeNode).optional();
  },
});
const presentation = {
  title: z.string().optional(),
  theme: z.enum(['default', 'light', 'dark', 'academy']).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
};
const axes = { axisXTitle: z.string().optional(), axisYTitle: z.string().optional() };
const grouped = { stack: z.boolean().optional(), group: z.boolean().optional() };
// 先以字面量构造每个变体，再组成联合，保留图表类型与配置的对应关系。
const chartDataKeys = ['data', 'categories', 'series', 'percent'] as const;
function defineChart<const T extends string, S extends z.ZodRawShape>(
  type: T,
  config: z.ZodObject<S, z.core.$loose>,
) {
  const display = { ...presentation, type: z.literal(type).optional() };
  // 过滤的键与类型投影一致；报告只接收展示配置，数据来自查询证据。
  const options = Object.fromEntries(
    Object.entries(config.shape).filter(([key]) => !chartDataKeys.some((data) => data === key)),
  ) as Omit<S, (typeof chartDataKeys)[number]>;
  return {
    full: z.object({ chartType: z.literal(type), config: config.extend(display) }).strict(),
    artifact: z
      .object({
        chartType: z.literal(type),
        config: z.looseObject(options).extend(display),
      })
      .strict(),
  };
}

const chartDefinitions = [
  defineChart('column', z.looseObject({ data: observations, ...axes, ...grouped })),
  defineChart('bar', z.looseObject({ data: observations, ...axes, ...grouped })),
  defineChart('line', z.looseObject({ data: z.array(timeValue).min(1), ...axes })),
  defineChart(
    'area',
    z.looseObject({ data: z.array(timeValue).min(1), ...axes, stack: z.boolean().optional() }),
  ),
  defineChart(
    'pie',
    z.looseObject({
      data: z.array(z.looseObject({ category: label, value: number.nonnegative() })).min(1),
      innerRadius: number.min(0).max(1).optional(),
    }),
  ),
  defineChart(
    'scatter',
    z.looseObject({
      data: z.array(z.looseObject({ x: number, y: number, group })).min(1),
      ...axes,
    }),
  ),
  defineChart(
    'histogram',
    z.looseObject({
      data: z.array(number).min(1),
      binNumber: z.number().int().positive().optional(),
      ...axes,
    }),
  ),
  defineChart('boxplot', z.looseObject({ data: observations, ...axes })),
  defineChart('violin', z.looseObject({ data: observations, ...axes })),
  defineChart(
    'radar',
    z.looseObject({
      data: z.array(z.looseObject({ name: label, value: number, group })).min(1),
      align: z.boolean().optional(),
    }),
  ),
  defineChart('funnel', z.looseObject({ data: observations })),
  defineChart(
    'waterfall',
    z.looseObject({
      data: z
        .array(
          z.union([
            categoryValue.extend({ isTotal: z.literal(false).optional() }),
            z.looseObject({ category: label, isTotal: z.literal(true), value: number.optional() }),
          ]),
        )
        .min(1),
      ...axes,
    }),
  ),
  defineChart(
    'liquid',
    z.looseObject({
      percent: number.min(0).max(1),
      shape: z.enum(['rect', 'circle', 'pin', 'triangle']).optional(),
    }),
  ),
  defineChart(
    'word-cloud',
    z.looseObject({
      data: z.array(z.looseObject({ text: z.string(), value: number })).min(1),
    }),
  ),
  defineChart(
    'venn',
    z.looseObject({
      data: z
        .array(
          z.looseObject({
            sets: z.array(z.string()).min(1),
            value: number.nonnegative(),
            label: z.string().optional(),
          }),
        )
        .min(1),
    }),
  ),
  defineChart('treemap', z.looseObject({ data: z.array(treeNode).min(1) })),
  defineChart(
    'sankey',
    z.looseObject({
      data: z
        .array(z.looseObject({ source: label, target: label, value: number.nonnegative() }))
        .min(1),
      nodeAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
    }),
  ),
  defineChart('table', z.looseObject({ data: z.array(z.record(z.string(), z.unknown())).min(1) })),
  defineChart(
    'dual-axes',
    z.looseObject({
      categories: z.array(label).min(1),
      series: z
        .array(
          z.looseObject({
            type: z.enum(['column', 'line']),
            axisYTitle: z.string().optional(),
            data: z.array(number).min(1),
          }),
        )
        .min(1),
      axisXTitle: z.string().optional(),
    }),
  ),
] as const;
const chartSchemas = chartDefinitions.map((chart) => chart.full);
export const chartSpec = z.discriminatedUnion('chartType', [
  chartSchemas[0]!,
  ...chartSchemas.slice(1),
]);
const artifactChartSchemas = chartDefinitions.map((chart) => chart.artifact);
export const artifactChartSpec = z.discriminatedUnion('chartType', [
  artifactChartSchemas[0]!,
  ...artifactChartSchemas.slice(1),
]);

// -----------------------------------------------------------------------------
// 公开结果类型
// -----------------------------------------------------------------------------

export type SourceResult = z.infer<typeof sourceResult>;
export type SourceConfig = z.infer<typeof sourceConfig>;
export type FileSourceType = z.infer<typeof fileSourceType>;
export type SchemaResult = z.infer<typeof schemaResult>;
export type QueryResult = z.infer<typeof queryResult>;
export type ExecutedQueryResult = QueryResult & { queryId: string };
export type SemanticDefinition = z.infer<typeof semanticResult>;
export type ChartSpec = z.infer<typeof chartSpec>;
export interface CleanupReport {
  disposed: string[];
  retained: string[];
  retainedDirectories?: Record<string, string>;
  errors: { datasetId: string; message: string }[];
}
