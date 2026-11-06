import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { Runtime, checkEnvironment, metadata, runDemo } from './runtime.mjs';

export function createServer(runtime = new Runtime()) {
  const server = new McpServer({ name: 'ava-workbuddy', version: metadata.version });
  const id = z.string().regex(/^ds_[a-z0-9_-]+$/).describe('ID returned by ava_source in this MCP connection');
  const register = (name, description, inputSchema, handler, annotations) => server.registerTool(name, {
    description, inputSchema, annotations: { openWorldHint: false, destructiveHint: false, ...annotations },
  }, async (input) => {
    try {
      const result = await handler(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
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
  return { server, runtime };
}

export async function serve() {
  checkEnvironment();
  const { server, runtime } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const onclose = transport.onclose;
  transport.onclose = () => { onclose?.(); void runtime.close(); };
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
    await runtime.close();
  });
}
