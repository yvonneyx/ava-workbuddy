import { McpServer, type ToolAnnotations } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { Runtime } from './runtime.js';
import { checkEnvironment } from './environment.js';
import { metadata } from './metadata.js';
import { runDemo } from './demo.js';

export function createServer(runtime = new Runtime()) {
  const server = new McpServer({ name: 'ava-workbuddy', version: metadata.version });
  const id = z.string().regex(/^ds_[a-z0-9_-]+$/).describe('ID returned by ava_source in this MCP connection');
  const pending = new Set<Promise<object>>();
  let cleanup: Promise<Awaited<ReturnType<Runtime['close']>>> | undefined;
  const register = <S extends Record<string, z.ZodType>>(
    name: string,
    description: string,
    inputSchema: z.ZodObject<S>,
    handler: (input: z.output<z.ZodObject<S>>) => object | Promise<object>,
    annotations?: ToolAnnotations,
  ) => server.registerTool<never, z.ZodObject<S>>(name, {
    description, inputSchema, annotations: { openWorldHint: false, destructiveHint: false, ...annotations },
  }, async (input) => {
    try {
      if (cleanup) throw new Error('The integration is shutting down.');
      const operation = Promise.resolve().then(() => handler(input));
      pending.add(operation);
      let result: object;
      try { result = await operation; }
      finally { pending.delete(operation); }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  register('ava_check', 'Check local runtime and pinned AVA version. Read-only; does not prove socket access or chart preview.', z.object({}), () => checkEnvironment(), { readOnlyHint: true });
  register('ava_demo', 'Run the bundled 8-row synthetic sales example: independently verify totals and contributions, save query/results/HTML, then dispose its session. No model key required. Report htmlGenerated separately from visual preview.', z.object({
    outputDirectory: z.string().optional().describe('Absolute path to a NEW directory, or omit to use a new temporary directory'),
  }), ({ outputDirectory }) => runDemo(outputDirectory));
  register('ava_source', 'Load a user-supplied local CSV/XLSX file with DuckDB. Returns datasetId; follow with ava_schema. Sessions expire after 30 idle minutes.', z.object({ path: z.string().describe('Absolute local attachment path; no URLs') }), ({ path }) => runtime.source(path));
  register('ava_schema', 'Inspect real tables, columns, types, language, and SQL rules before writing queries.', z.object({ datasetId: id }), ({ datasetId }) => runtime.schema(datasetId), { readOnlyHint: true });
  register('ava_query', 'Execute read-only DuckDB SQL against the loaded dataset. Aggregate in SQL. Check truncation before conclusions. SQL must implement the confirmed business definitions; semantic metadata does not rewrite SQL.', z.object({
    datasetId: id, sql: z.string().min(1).max(512 * 1024), maxRows: z.number().int().min(1).max(10000).optional(),
  }), ({ datasetId, sql, maxRows }) => runtime.query(datasetId, sql, maxRows), { readOnlyHint: true });
  register('ava_semantic', 'Read business definitions, or replace the COMPLETE session definition with supplied JSON. Read and merge existing definitions first. Does not persist definitions or rewrite SQL.', z.object({
    datasetId: id, definition: z.record(z.string(), z.unknown()).optional(),
  }), ({ datasetId, definition }) => runtime.semantic(datasetId, definition));
  register('ava_viz', 'Render verified query results as a GPT-Vis chart HTML. Spec requires chartType and config, not syntax. Absolute output path must be new; parent directory must exist. HTML needs network for GPT-Vis; generation does not prove visual rendering.', z.object({
    spec: z.object({ chartType: z.string(), config: z.record(z.string(), z.unknown()) }).strict(), output: z.string(),
  }), ({ spec, output }) => runtime.viz(spec, output));
  register('ava_dispose', 'Release an idle dataset owned by this connection. Do not use to cancel a running or timed-out query. Saved HTML and result files remain available.', z.object({ datasetId: id }), ({ datasetId }) => runtime.dispose(datasetId));
  const close = () => {
    cleanup ??= Promise.resolve().then(async () => {
      await server.close();
      await Promise.allSettled([...pending]);
      return runtime.close();
    });
    return cleanup;
  };
  server.server.onclose = () => { void close().catch(() => {}); };
  return { server, runtime, close };
}

export async function serve(): Promise<void> {
  checkEnvironment();
  const connection = createServer();
  let stop: () => void = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      let stopping = false;
      stop = () => {
        if (stopping) return;
        stopping = true;
        void connection.close().then((report) => {
          for (const failure of report.errors) process.stderr.write(`Session cleanup: ${failure.datasetId}: ${failure.message}\n`);
          resolve();
        }, reject);
      };
      connection.server.server.onclose = stop;
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, stop);
      void connection.server.connect(new StdioServerTransport()).catch(reject);
    });
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeListener(signal, stop);
    await connection.close();
  }
}
