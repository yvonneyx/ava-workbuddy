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
const nativeChartConfigs = {
  column: z.looseObject({ data: observations, ...axes, ...grouped }),
  bar: z.looseObject({ data: observations, ...axes, ...grouped }),
  line: z.looseObject({ data: z.array(timeValue).min(1), ...axes }),
  area: z.looseObject({ data: z.array(timeValue).min(1), ...axes, stack: z.boolean().optional() }),
  pie: z.looseObject({
    data: z.array(z.looseObject({ category: label, value: number.nonnegative() })).min(1),
    innerRadius: number.min(0).max(1).optional(),
  }),
  scatter: z.looseObject({
    data: z.array(z.looseObject({ x: number, y: number, group })).min(1),
    ...axes,
  }),
  histogram: z.looseObject({
    data: z.array(number).min(1),
    binNumber: z.number().int().positive().optional(),
    ...axes,
  }),
  boxplot: z.looseObject({ data: observations, ...axes }),
  violin: z.looseObject({ data: observations, ...axes }),
  radar: z.looseObject({
    data: z.array(z.looseObject({ name: label, value: number, group })).min(1),
    align: z.boolean().optional(),
  }),
  funnel: z.looseObject({ data: observations }),
  waterfall: z.looseObject({
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
  liquid: z.looseObject({
    percent: number.min(0).max(1),
    shape: z.enum(['rect', 'circle', 'pin', 'triangle']).optional(),
  }),
  'word-cloud': z.looseObject({
    data: z.array(z.looseObject({ text: z.string(), value: number })).min(1),
  }),
  venn: z.looseObject({
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
  treemap: z.looseObject({ data: z.array(treeNode).min(1) }),
  sankey: z.looseObject({
    data: z
      .array(z.looseObject({ source: label, target: label, value: number.nonnegative() }))
      .min(1),
    nodeAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
  }),
  table: z.looseObject({ data: z.array(z.record(z.string(), z.unknown())).min(1) }),
  'dual-axes': z.looseObject({
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
};

const chartTypes = Object.keys(nativeChartConfigs) as (keyof typeof nativeChartConfigs)[];
const chartSchemas = chartTypes.map((type) =>
  z
    .object({
      chartType: z.literal(type),
      config: nativeChartConfigs[type].extend({
        ...presentation,
        type: z.literal(type).optional(),
      }),
    })
    .strict(),
);
export const chartSpec = z.discriminatedUnion('chartType', [
  chartSchemas[0]!,
  ...chartSchemas.slice(1),
]);

// 报告先接收展示配置，数据绑定完成后再按完整 chartSpec 校验。
const artifactChartSchemas = chartTypes.map((type) => {
  // 数据由查询证据提供，MCP 报告参数只展示该图表的渲染选项。
  const options = Object.fromEntries(
    Object.entries(nativeChartConfigs[type].shape).filter(
      ([key]) => !['data', 'categories', 'series', 'percent'].includes(key),
    ),
  );
  return z
    .object({
      chartType: z.literal(type),
      config: z.looseObject(options).extend({ ...presentation, type: z.literal(type).optional() }),
    })
    .strict();
});
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
  errors: { datasetId: string; message: string }[];
}
