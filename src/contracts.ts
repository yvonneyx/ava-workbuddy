import { z } from 'zod/v4';

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
export const chartSpec = z
  .object({
    chartType: z.string().describe('Native AVA chart type, for example bar, column, line or pie'),
    config: z
      .record(z.string(), z.unknown())
      .describe(
        'Native AVA/GPT-Vis options; AVA sets type from chartType. Use SQL aliases ' +
          'and casts to produce native fields and numeric values; put units in ' +
          'titles or axis labels. Native data shapes (not an exhaustive type list): ' +
          'bar/column: data=[{category,value,group?}]; pie: data=[{category,value}], ' +
          'non-negative with a positive total; line/area: data=[{time,value,group?}], ' +
          'ordered by time; scatter: data=[{x,y,group?}]; histogram: data=number[]; ' +
          'boxplot/violin: data=[{category,value}], multiple observations per ' +
          'category; dual-axes: categories and series of native series objects; ' +
          'liquid: percent between 0 and 1. Standalone viz includes data here; ' +
          'artifact binds data from query evidence as described on its chart field.',
      ),
  })
  .strict();

// -----------------------------------------------------------------------------
// 公开结果类型
// -----------------------------------------------------------------------------

export type SourceResult = z.infer<typeof sourceResult>;
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
