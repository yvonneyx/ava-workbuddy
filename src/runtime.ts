import { constants } from 'node:fs';
import { chmod, copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { AVACommandError, runCommand, outputPath } from './ava.js';
import { isolateSource, prepareSource, sourceErrorRedactor } from './source.js';
import {
  sourceResult,
  chartSpec,
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

interface Session {
  source: string;
  directory: string;
  redactError: ReturnType<typeof sourceErrorRedactor>;
  state: 'idle' | 'busy' | 'uncertain' | 'released';
}

/** 一个实例只管理自己创建的会话；调用方应在 finally 中等待 close()。 */
export class Runtime {
  // -----------------------------------------------------------------------------
  // 会话状态与任务生命周期
  // -----------------------------------------------------------------------------

  #sessions = new Map<string, Session>();
  #queries = new Map<string, QueryEvidence>();
  #pending = new Set<Promise<unknown>>();
  #cleanup: Promise<CleanupReport> | undefined;

  /** @internal 子进程边界，仅在隔离测试中替换。 */
  protected invoke(args: string[], input?: string, directory?: string): Promise<unknown> {
    return runCommand(args, input, directory);
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
    directory?: string,
  ): Promise<z.output<S>> {
    const result = await this.invoke(args, input, directory);
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
  #session<T>(id: string, operation: (session: Session) => Promise<T>): Promise<T> {
    return this.#run(async () => {
      const session = this.#sessions.get(id);
      if (!session || session.state === 'released') {
        throw new Error('This dataset is not owned by this MCP connection. Load the source again.');
      }
      if (session.state === 'uncertain') {
        throw new Error(
          'A previous operation has an uncertain outcome. Do not retry or dispose it ' +
            'automatically; inspect the task first.',
        );
      }
      if (session.state === 'busy') {
        throw new Error('A command is already running for this dataset. Wait for its result.');
      }
      session.state = 'busy';
      try {
        return await operation(session);
      } catch (error) {
        if (error instanceof AVACommandError && error.uncertain) {
          session.state = 'uncertain';
        }
        throw session.redactError(error);
      } finally {
        if (session.state === 'busy') {
          session.state = 'idle';
        }
      }
    });
  }

  // -----------------------------------------------------------------------------
  // 数据加载与查询证据
  // -----------------------------------------------------------------------------

  source(input: string | SourceConfig, type?: FileSourceType): Promise<SourceResult> {
    return this.#run(async () => {
      const { config, label } = await prepareSource(input, type);
      const redactError = sourceErrorRedactor(config);
      let directory: string | undefined;
      try {
        const isolated = await isolateSource(config);
        directory = isolated.directory;
        const result = await this.#execute(
          ['source', '-'],
          sourceResult,
          JSON.stringify(isolated.config),
          directory,
        );
        this.#sessions.set(result.datasetId, {
          source: label,
          directory,
          redactError,
          state: 'idle',
        });
        return result;
      } catch (error) {
        const failure = redactError(error);
        if (directory) {
          if (error instanceof AVACommandError && error.uncertain) {
            failure.message += `\nSource isolation directory retained: ${directory}`;
          } else {
            await rm(directory, { recursive: true, force: true });
          }
        }
        throw failure;
      }
    });
  }

  schema(id: string): Promise<SchemaResult> {
    return this.#session(id, (session) =>
      this.#execute(['schema', id], schemaResult, undefined, session.directory),
    );
  }

  async query(id: string, sql: string, maxRows?: number): Promise<ExecutedQueryResult> {
    if (!sql.trim() || Buffer.byteLength(sql) > 512 * 1024) {
      throw new Error('SQL must be non-empty and at most 512 KiB.');
    }
    if (maxRows !== undefined && (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000)) {
      throw new Error('maxRows must be between 1 and 10000.');
    }
    return this.#session(id, async (session) => {
      const result = await this.#execute(
        ['query', id, '--dsl', '-', ...(maxRows ? ['--max-rows', String(maxRows)] : [])],
        queryResult,
        sql,
        session.directory,
      );
      const queryId = `q_${randomUUID()}`;
      this.#queries.set(queryId, {
        queryId,
        datasetId: id,
        source: session.source,
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
    return this.#session(id, async (session) => {
      if (definition === undefined) {
        return this.#execute(['semantic', id], semanticResult, undefined, session.directory);
      }
      const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-semantic-'));
      try {
        const file = join(directory, 'semantic.json');
        await writeFile(file, JSON.stringify(semanticResult.parse(definition)), { mode: 0o600 });
        return await this.#execute(
          ['semantic', id, '--file', file],
          semanticResult,
          undefined,
          session.directory,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

  viz(spec: ChartSpec, output: string) {
    return this.#run(async () => {
      const destination = outputPath(output);
      const input = JSON.stringify(chartSpec.parse(spec));
      const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-viz-'));
      try {
        // 上游按默认权限写 HTML；先在私有目录生成，避免导出时短暂暴露内嵌数据。
        const staged = join(directory, 'chart.html');
        await this.#execute(['viz', '--spec', '-', '--output', staged], vizResult, input);
        await chmod(staged, 0o600);
        await copyFile(staged, destination, constants.COPYFILE_EXCL);
        return { output: destination };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
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
    // released 表示上游已结束但本地清理失败，允许再次清理目录。
    const session = this.#sessions.get(id);
    if (session?.state === 'released') {
      return this.#run(() => this.#release(id, session));
    }
    return this.#session(id, (owned) => this.#release(id, owned));
  }

  async #release(id: string, session: Session) {
    if (session.state !== 'released') {
      try {
        await this.#execute(['dispose', id], disposeResult, undefined, session.directory);
      } catch (error) {
        if (!(error instanceof AVACommandError) || !error.unavailable) {
          throw error;
        }
        // 固定版本 AVA 在释放引擎后删除会话目录；仅 socket 不通不足以确认任务结束。
        const exists = await stat(join(session.directory, `ava-${id}`)).then(
          () => true,
          (failure: NodeJS.ErrnoException) => {
            if (failure.code === 'ENOENT') return false;
            throw failure;
          },
        );
        if (exists) throw error;
      }
      session.state = 'released';
    }
    await rm(session.directory, { recursive: true, force: true });
    this.#sessions.delete(id);
    return { datasetId: id, disposed: true as const };
  }

  /** 停止接收新任务，等待已接受的任务，再释放确定空闲的会话。 */
  close(): Promise<CleanupReport> {
    this.#cleanup ??= Promise.resolve().then(async () => {
      await Promise.allSettled([...this.#pending]);
      const report: CleanupReport = { disposed: [], retained: [], errors: [] };
      for (const [id, session] of this.#sessions) {
        if (session.state === 'uncertain') continue;
        try {
          await this.#release(id, session);
          report.disposed.push(id);
        } catch (error) {
          report.errors.push({ datasetId: id, message: session.redactError(error).message });
        }
      }
      report.retained = [...this.#sessions.keys()];
      if (report.retained.length) {
        report.retainedDirectories = Object.fromEntries(
          [...this.#sessions].map(([id, session]) => [id, session.directory]),
        );
      }
      this.#queries.clear();
      this.#sessions.clear();
      return report;
    });
    return this.#cleanup;
  }
}
