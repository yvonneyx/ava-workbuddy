import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { AVACommandError, runCommand, outputPath } from './ava.js';
import { prepareSource, sourceError } from './source.js';
import {
  sourceResult,
  schemaResult,
  queryResult,
  semanticResult,
  vizResult,
  disposeResult,
  type ChartSpec,
  type CleanupReport,
  type SemanticDefinition,
  type SourceResult,
  type SourceConfig,
  type FileSourceType,
  type SchemaResult,
  type ExecutedQueryResult,
} from './contracts.js';
import { createArtifact, type ArtifactInput, type QueryEvidence } from './artifact.js';

/** 一个实例只管理自己创建的会话；调用方应在 finally 中等待 close()。 */
export class Runtime {
  // -----------------------------------------------------------------------------
  // 会话状态与任务生命周期
  // -----------------------------------------------------------------------------

  #sources = new Map<string, string>();
  #queries = new Map<string, QueryEvidence>();
  #busy = new Set<string>();
  #uncertain = new Set<string>();
  #pending = new Set<Promise<unknown>>();
  #cleanup: Promise<CleanupReport> | undefined;

  /** @internal 子进程边界，仅在隔离测试中替换。 */
  protected invoke(args: string[], input?: string): Promise<unknown> {
    return runCommand(args, input);
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#cleanup) {
      return Promise.reject(new Error('The integration is shutting down.'));
    }
    // 先登记任务再做文件 I/O，关闭时才能等到尚未完成的加载。
    const pending = Promise.resolve().then(operation);
    this.#pending.add(pending);
    void pending.then(
      () => this.#pending.delete(pending),
      () => this.#pending.delete(pending),
    );
    return pending;
  }

  async #execute<S extends z.ZodType>(
    args: string[],
    schema: S,
    input?: string,
  ): Promise<z.output<S>> {
    const result = await this.invoke(args, input);
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      throw new AVACommandError(
        'AVA returned an unexpected response; the command outcome is uncertain.',
        true,
      );
    }
    return parsed.data;
  }

  // 结果不确定的任务可能仍在 AVA 中运行，因此阻止自动重试和释放。
  #session<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return this.#run(async () => {
      if (!this.#sources.has(id)) {
        throw new Error('This dataset is not owned by this MCP connection. Load the source again.');
      }
      if (this.#uncertain.has(id)) {
        throw new Error(
          'A previous operation has an uncertain outcome. Do not retry or dispose it ' +
            'automatically; inspect the task first.',
        );
      }
      if (this.#busy.has(id)) {
        throw new Error('A command is already running for this dataset. Wait for its result.');
      }
      this.#busy.add(id);
      try {
        return await operation();
      } catch (error) {
        if (error instanceof AVACommandError && error.uncertain) {
          this.#uncertain.add(id);
        }
        throw error;
      } finally {
        this.#busy.delete(id);
      }
    });
  }

  // -----------------------------------------------------------------------------
  // 数据加载与查询证据
  // -----------------------------------------------------------------------------

  source(input: string | SourceConfig, type?: FileSourceType): Promise<SourceResult> {
    return this.#run(async () => {
      const { config, label } = await prepareSource(input, type);
      try {
        const result = await this.#execute(['source', '-'], sourceResult, JSON.stringify(config));
        this.#sources.set(result.datasetId, label);
        return result;
      } catch (error) {
        throw sourceError(error, config);
      }
    });
  }

  schema(id: string): Promise<SchemaResult> {
    return this.#session(id, () => this.#execute(['schema', id], schemaResult));
  }

  async query(id: string, sql: string, maxRows?: number): Promise<ExecutedQueryResult> {
    if (!sql.trim() || Buffer.byteLength(sql) > 512 * 1024) {
      throw new Error('SQL must be non-empty and at most 512 KiB.');
    }
    if (maxRows !== undefined && (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000)) {
      throw new Error('maxRows must be between 1 and 10000.');
    }
    return this.#session(id, async () => {
      const result = await this.#execute(
        ['query', id, '--dsl', '-', ...(maxRows ? ['--max-rows', String(maxRows)] : [])],
        queryResult,
        sql,
      );
      const queryId = `q_${randomUUID()}`;
      this.#queries.set(queryId, {
        queryId,
        datasetId: id,
        source: this.#sources.get(id)!,
        sql,
        executedAt: new Date().toISOString(),
        result: structuredClone(result),
      });
      // 快照与返回值隔离；释放数据集后，最近 32 次查询仍可用于生成报告。
      if (this.#queries.size > 32) {
        this.#queries.delete(this.#queries.keys().next().value!);
      }
      return { ...result, queryId };
    });
  }

  // -----------------------------------------------------------------------------
  // 业务定义、图表与报告
  // -----------------------------------------------------------------------------

  semantic(id: string, definition?: SemanticDefinition): Promise<SemanticDefinition> {
    return this.#session(id, async () => {
      if (definition === undefined) {
        return this.#execute(['semantic', id], semanticResult);
      }
      const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-semantic-'));
      try {
        const file = join(directory, 'semantic.json');
        await writeFile(file, JSON.stringify(semanticResult.parse(definition)), { mode: 0o600 });
        return await this.#execute(['semantic', id, '--file', file], semanticResult);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

  viz(spec: ChartSpec, output: string) {
    return this.#run(() =>
      this.#execute(
        ['viz', '--spec', '-', '--output', outputPath(output)],
        vizResult,
        JSON.stringify(spec),
      ),
    );
  }

  artifact(input: ArtifactInput) {
    return this.#run(() =>
      createArtifact(input, this.#queries, (spec, output) =>
        this.#execute(
          ['viz', '--spec', '-', '--output', outputPath(output)],
          vizResult,
          JSON.stringify(spec),
        ),
      ),
    );
  }

  // -----------------------------------------------------------------------------
  // 会话释放与关闭
  // -----------------------------------------------------------------------------

  dispose(id: string) {
    return this.#session(id, async () => {
      const result = await this.#execute(['dispose', id], disposeResult);
      this.#sources.delete(id);
      return result;
    });
  }

  /** 停止接收新任务，等待已接受的任务，再释放确定空闲的会话。 */
  close(): Promise<CleanupReport> {
    this.#cleanup ??= Promise.resolve().then(async () => {
      await Promise.allSettled([...this.#pending]);
      const report: CleanupReport = { disposed: [], retained: [], errors: [] };
      for (const id of this.#sources.keys()) {
        if (this.#uncertain.has(id)) {
          continue;
        }
        try {
          await this.#execute(['dispose', id], disposeResult);
          this.#sources.delete(id);
          report.disposed.push(id);
        } catch (error) {
          report.errors.push({
            datasetId: id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      report.retained = [...this.#sources.keys()];
      this.#queries.clear();
      return report;
    });
    return this.#cleanup;
  }
}
