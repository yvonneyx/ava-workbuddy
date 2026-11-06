import { McpServer, type ToolAnnotations } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { Runtime } from './runtime.js';
import { checkEnvironment } from './ava.js';
import { metadata } from './metadata.js';
import { artifactInput } from './artifact.js';
import { chartSpec } from './contracts.js';

// -----------------------------------------------------------------------------
// MCP 工具注册与调用生命周期

// -----------------------------------------------------------------------------

export function createServer(runtime = new Runtime()) {
  const server = new McpServer({ name: 'ava-workbuddy', version: metadata.version });
  const id = z
    .string()
    .regex(/^ds_[a-z0-9_-]+$/)
    .describe('ID returned by ava_source in this MCP connection');
  const pending = new Set<Promise<object>>();
  let cleanup: Promise<Awaited<ReturnType<Runtime['close']>>> | undefined;
  const register = <S extends Record<string, z.ZodType>>(
    name: string,
    description: string,
    inputSchema: z.ZodObject<S>,
    handler: (input: z.output<z.ZodObject<S>>) => object | Promise<object>,
    annotations?: ToolAnnotations,
  ) =>
    server.registerTool<never, z.ZodObject<S>>(
      name,
      {
        description,
        inputSchema,
        annotations: { openWorldHint: false, destructiveHint: false, ...annotations },
      },
      async (input) => {
        try {
          if (cleanup) {
            throw new Error('The integration is shutting down.');
          }
          // 调用可能仍在等待异步校验；关闭入口前必须等完已接受的操作。
          const operation = Promise.resolve().then(() => handler(input));
          pending.add(operation);
          let result: object;
          try {
            result = await operation;
          } finally {
            pending.delete(operation);
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              { type: 'text', text: error instanceof Error ? error.message : String(error) },
            ],
          };
        }
      },
    );

  // -----------------------------------------------------------------------------
  // 运行环境检查

  // -----------------------------------------------------------------------------

  register(
    'ava_check',
    'Check local runtime and pinned AVA version. Read-only; does not prove socket ' +
      'access or chart preview.',
    z.object({}),
    () => checkEnvironment(),
    { readOnlyHint: true },
  );

  // -----------------------------------------------------------------------------
  // 数据加载、结构、查询与业务定义

  // -----------------------------------------------------------------------------

  register(
    'ava_source',
    'Load a user-supplied local CSV/XLSX file with DuckDB. Returns datasetId; ' +
      'follow with ava_schema. Sessions expire after 30 idle minutes.',
    z.object({ path: z.string().describe('Absolute local attachment path; no URLs') }),
    ({ path }) => runtime.source(path),
  );
  register(
    'ava_schema',
    'Inspect real tables, columns, types, language, and SQL rules before writing queries.',
    z.object({ datasetId: id }),
    ({ datasetId }) => runtime.schema(datasetId),
    { readOnlyHint: true },
  );
  register(
    'ava_query',
    'Execute read-only DuckDB SQL and return queryId for artifact evidence. The ' +
      'latest 32 results and exact SQL are retained in this connection. Check ' +
      'truncation and scope. Semantic metadata does not rewrite SQL.',
    z.object({
      datasetId: id,
      sql: z
        .string()
        .min(1)
        .max(512 * 1024),
      maxRows: z.number().int().min(1).max(10000).optional(),
    }),
    ({ datasetId, sql, maxRows }) => runtime.query(datasetId, sql, maxRows),
    { readOnlyHint: true },
  );
  register(
    'ava_semantic',
    'Read business definitions, or replace the COMPLETE session definition with ' +
      'supplied JSON. Read and merge existing definitions first. Does not persist ' +
      'definitions or rewrite SQL.',
    z.object({
      datasetId: id,
      definition: z.record(z.string(), z.unknown()).optional(),
    }),
    ({ datasetId, definition }) => runtime.semantic(datasetId, definition),
  );

  // -----------------------------------------------------------------------------
  // 原生可视化与报告组织

  // -----------------------------------------------------------------------------

  register(
    'ava_viz',
    'Render verified query results as a GPT-Vis chart HTML. Spec requires ' +
      'chartType and config, not syntax. Absolute output path must be new; parent ' +
      'directory must exist. HTML needs network for GPT-Vis; generation does not ' +
      'prove visual rendering.',
    z.object({
      spec: chartSpec,
      output: z.string(),
    }),
    ({ spec, output }) => runtime.viz(spec, output),
  );
  register(
    'ava_artifact',
    'Create one fixed-template analysis HTML and matching evidence JSON with ' +
      'questions, conclusions, charts, tables, and exact SQL. Reference ava_query ' +
      'queryIds from this connection. Charts use AVA chartType/config; query rows ' +
      'supply config.data, so alias SQL columns to native GPT-Vis fields. For ' +
      'special data shapes, chartConfigField selects a native config object from a ' +
      'single-row query. Never provide inline data, categories, series or percent; ' +
      'these must come from query evidence. Other chart options pass through to ' +
      'AVA. Use NEW .html and matching .json paths. This does not independently ' +
      'verify assistant conclusions or browser rendering.',
    artifactInput,
    (input) => runtime.artifact(input),
  );

  // -----------------------------------------------------------------------------
  // 连接关闭与会话清理

  // -----------------------------------------------------------------------------

  register(
    'ava_dispose',
    'Release an idle dataset owned by this connection. Do not use to cancel a ' +
      'running or timed-out query. Saved HTML and result files remain available.',
    z.object({ datasetId: id }),
    ({ datasetId }) => runtime.dispose(datasetId),
  );
  const close = () => {
    cleanup ??= Promise.resolve().then(async () => {
      // 先关闭协议入口，再等待工具调用，最后清理数据会话。
      await server.close();
      await Promise.allSettled([...pending]);
      return runtime.close();
    });
    return cleanup;
  };
  server.server.onclose = () => {
    void close().catch(() => {});
  };
  return { server, runtime, close };
}

// -----------------------------------------------------------------------------
// stdio 进程生命周期

// -----------------------------------------------------------------------------

export async function serve(): Promise<void> {
  checkEnvironment();
  const connection = createServer();
  let stop: () => void = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      let stopping = false;
      stop = () => {
        if (stopping) {
          return;
        }
        stopping = true;
        // EOF 与进程信号共用幂等关闭流程。
        void connection.close().then((report) => {
          for (const failure of report.errors) {
            process.stderr.write(`Session cleanup: ${failure.datasetId}: ${failure.message}\n`);
          }
          resolve();
        }, reject);
      };
      connection.server.server.onclose = stop;
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, stop);
      }
      void connection.server.connect(new StdioServerTransport()).catch(reject);
    });
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.removeListener(signal, stop);
    }
    await connection.close();
  }
}
