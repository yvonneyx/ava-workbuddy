import { z } from 'zod/v4';

export const sourceResult = z.object({ datasetId: z.string().regex(/^ds_[a-z0-9_-]+$/) });
export const schemaResult = z.looseObject({
  language: z.looseObject({ name: z.string(), fence: z.string() }),
  models: z.array(z.looseObject({
    name: z.string(),
    tableReference: z.looseObject({ table: z.string() }),
    columns: z.array(z.looseObject({ name: z.string(), type: z.string() })),
  })),
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

export type SourceResult = z.infer<typeof sourceResult>;
export type SchemaResult = z.infer<typeof schemaResult>;
export type QueryResult = z.infer<typeof queryResult>;
export type SemanticDefinition = z.infer<typeof semanticResult>;
export interface ChartSpec { chartType: string; config: Record<string, unknown> }
export interface CleanupReport {
  disposed: string[];
  retained: string[];
  errors: { datasetId: string; message: string }[];
}
