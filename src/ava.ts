import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { root, metadata } from './metadata.js';
import { fileSourceType, type FileSourceType } from './contracts.js';

// -----------------------------------------------------------------------------
// 依赖定位与运行环境
// -----------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const avaMetadataPath = require.resolve('@antv/ava/package.json');
const avaMetadata = JSON.parse(readFileSync(avaMetadataPath, 'utf8')) as {
  version: string;
  bin: { ava: string };
};
const avaCLI = resolve(dirname(avaMetadataPath), avaMetadata.bin.ava);

export function checkEnvironment(
  nodeVersion = process.versions.node,
  platform: string = process.platform,
) {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 13))) {
    throw new Error('Node.js 22.13.0 or newer is required.');
  }
  if (!['darwin', 'linux'].includes(platform)) {
    throw new Error(
      `AVA sessions currently support macOS/Linux only. Windows is not supported in v${metadata.version}.`,
    );
  }
  if (avaMetadata.version !== metadata.dependencies['@antv/ava']) {
    throw new Error('Installed AVA does not match the pinned version. Reinstall this integration.');
  }
  return {
    ready: true,
    integrationVersion: metadata.version,
    avaVersion: avaMetadata.version,
    nodeVersion,
    platform,
    authentication: 'none-local-stdio',
    chartPreviewVerified: false,
  };
}

// -----------------------------------------------------------------------------
// 本地文件边界
// -----------------------------------------------------------------------------

export const fileSourceTypes: Record<string, FileSourceType> = {
  '.csv': 'csv-file',
  '.json': 'json-file',
  '.parquet': 'parquet',
  '.xlsx': 'excel',
  '.sqlite': 'sqlite',
  '.sqlite3': 'sqlite',
  '.db': 'sqlite',
};

export async function sourcePath(path: string, type?: FileSourceType) {
  if (!isAbsolute(path)) {
    throw new Error('Provide an absolute path to the local file supplied by the user.');
  }
  if (type !== undefined) {
    fileSourceType.parse(type);
  } else if (!fileSourceTypes[extname(path).toLowerCase()]) {
    throw new Error('Cannot infer the source type. Provide a file source type explicitly.');
  }
  const resolved = await realpath(path);
  if (
    !type &&
    fileSourceTypes[extname(resolved).toLowerCase()] !==
      fileSourceTypes[extname(path).toLowerCase()]
  ) {
    throw new Error(
      'The resolved source must have the same file type; otherwise set type explicitly.',
    );
  }
  if (!(await stat(resolved)).isFile()) {
    throw new Error('The source must be a regular file.');
  }
  return resolved;
}

export function outputPath(path: string) {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.html') {
    throw new Error(
      'Provide an absolute output path ending in .html. Existing files are not overwritten.',
    );
  }
  return path;
}

// -----------------------------------------------------------------------------
// AVA 子进程与错误处理
// -----------------------------------------------------------------------------

/** 命令结果不确定时，AVA 的独立会话进程可能仍在执行任务。 */
export class AVACommandError extends Error {
  constructor(message: string, public readonly uncertain = false) {
    super(message);
    this.name = 'AVACommandError';
  }
}

export function runCommand(args: string[], input?: string): Promise<unknown> {
  checkEnvironment();
  return new Promise((resolve, reject) => {
    // 使用参数数组和 stdin，保留原始 SQL/JSON，避免 shell 拼接。
    const child = execFile(
      process.execPath,
      [avaCLI, ...args],
      {
        cwd: root,
        timeout: 75_000,
        maxBuffer: 20 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new AVACommandError(
              error.killed
                ? 'AVA command timed out; the operation may still be running. Do not ' +
                  'automatically retry or dispose this session.'
                : stderr.trim() || error.message,
              Boolean(error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'),
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(
            new AVACommandError(
              'AVA returned invalid JSON; the command outcome is uncertain.',
              true,
            ),
          );
        }
      },
    );
    // 提前退出产生的 stdin 错误由 execFile 统一报告。
    child.stdin?.on('error', () => {});
    child.stdin?.end(input ?? '');
  });
}
