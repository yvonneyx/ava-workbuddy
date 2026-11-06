import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { AVACommandError, runCommand } from './command.js';
import { outputPath, sourcePath } from './paths.js';
import {
  sourceResult, schemaResult, queryResult, semanticResult, vizResult, disposeResult,
  type ChartSpec, type CleanupReport, type SemanticDefinition, type SourceResult,
  type SchemaResult, type ExecutedQueryResult,
} from './contracts.js';
import { createArtifact, type ArtifactInput, type QueryEvidence } from './artifact.js';

/** One owner for a set of local AVA sessions. Always await close() in a finally block. */
export class Runtime {
  #sessions = new Set<string>();
  #sources = new Map<string, string>();
  #queries = new Map<string, QueryEvidence>();
  #busy = new Set<string>();
  #uncertain = new Set<string>();
  #pending = new Set<Promise<unknown>>();
  #cleanup: Promise<CleanupReport> | undefined;

  /** @internal Subprocess boundary; override only in isolated tests. */
  protected invoke(args: string[], input?: string): Promise<unknown> {
    return runCommand(args, input);
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#cleanup) return Promise.reject(new Error('The integration is shutting down.'));
    // Track before any file I/O so close also waits for a source that is still resolving.
    const pending = Promise.resolve().then(operation);
    this.#pending.add(pending);
    void pending.then(() => this.#pending.delete(pending), () => this.#pending.delete(pending));
    return pending;
  }

  async #execute<S extends z.ZodType>(args: string[], schema: S, input?: string): Promise<z.output<S>> {
    const result = await this.invoke(args, input);
    const parsed = schema.safeParse(result);
    if (!parsed.success) throw new AVACommandError('AVA returned an unexpected response; the command outcome is uncertain.', true);
    return parsed.data;
  }

  #session<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return this.#run(async () => {
      if (!this.#sessions.has(id)) throw new Error('This dataset is not owned by this MCP connection. Load the source again.');
      if (this.#uncertain.has(id)) throw new Error('A previous operation has an uncertain outcome. Do not retry or dispose it automatically; inspect the task first.');
      if (this.#busy.has(id)) throw new Error('A command is already running for this dataset. Wait for its result.');
      this.#busy.add(id);
      try { return await operation(); }
      catch (error) {
        if (error instanceof AVACommandError && error.uncertain) this.#uncertain.add(id);
        throw error;
      } finally { this.#busy.delete(id); }
    });
  }

  source(path: string): Promise<SourceResult> {
    return this.#run(async () => {
      const resolved = await sourcePath(path);
      const result = await this.#execute(['source', resolved], sourceResult);
      this.#sessions.add(result.datasetId);
      this.#sources.set(result.datasetId, basename(resolved));
      return result;
    });
  }

  schema(id: string): Promise<SchemaResult> {
    return this.#session(id, () => this.#execute(['schema', id], schemaResult));
  }

  async query(id: string, sql: string, maxRows?: number): Promise<ExecutedQueryResult> {
    if (!sql.trim() || Buffer.byteLength(sql) > 512 * 1024) throw new Error('SQL must be non-empty and at most 512 KiB.');
    if (maxRows !== undefined && (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000)) throw new Error('maxRows must be between 1 and 10000.');
    return this.#session(id, async () => {
      const result = await this.#execute(
        ['query', id, '--dsl', '-', ...(maxRows ? ['--max-rows', String(maxRows)] : [])], queryResult, sql,
      );
      const queryId = `q_${randomUUID()}`;
      this.#queries.set(queryId, { queryId, datasetId: id, source: this.#sources.get(id)!, sql,
        executedAt: new Date().toISOString(), result: structuredClone(result) });
      // Keep the latest 32 query snapshots per connection, including after dataset disposal.
      if (this.#queries.size > 32) this.#queries.delete(this.#queries.keys().next().value!);
      return { ...result, queryId };
    });
  }

  semantic(id: string, definition?: SemanticDefinition): Promise<SemanticDefinition> {
    return this.#session(id, async () => {
      if (definition === undefined) return this.#execute(['semantic', id], semanticResult);
      const directory = await mkdtemp(join(tmpdir(), 'ava-workbuddy-semantic-'));
      try {
        const file = join(directory, 'semantic.json');
        await writeFile(file, JSON.stringify(semanticResult.parse(definition)), { mode: 0o600 });
        return await this.#execute(['semantic', id, '--file', file], semanticResult);
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }

  viz(spec: ChartSpec, output: string) {
    return this.#run(() => this.#execute(['viz', '--spec', '-', '--output', outputPath(output)], vizResult, JSON.stringify(spec)));
  }

  artifact(input: ArtifactInput) {
    return this.#run(() => createArtifact(input, this.#queries, (spec, output) => this.#execute(
      ['viz', '--spec', '-', '--output', outputPath(output)], vizResult, JSON.stringify(spec),
    )));
  }

  dispose(id: string) {
    return this.#session(id, async () => {
      const result = await this.#execute(['dispose', id], disposeResult);
      this.#sessions.delete(id);
      this.#sources.delete(id);
      return result;
    });
  }

  /** Stop accepting work, drain pending operations, then dispose known idle sessions once. */
  close(): Promise<CleanupReport> {
    this.#cleanup ??= Promise.resolve().then(async () => {
      await Promise.allSettled([...this.#pending]);
      const report: CleanupReport = { disposed: [], retained: [], errors: [] };
      for (const id of this.#sessions) {
        if (this.#uncertain.has(id)) continue;
        try {
          await this.#execute(['dispose', id], disposeResult);
          this.#sessions.delete(id);
          this.#sources.delete(id);
          report.disposed.push(id);
        } catch (error) {
          report.errors.push({ datasetId: id, message: error instanceof Error ? error.message : String(error) });
        }
      }
      report.retained = [...this.#sessions];
      this.#queries.clear();
      return report;
    });
    return this.#cleanup;
  }
}
