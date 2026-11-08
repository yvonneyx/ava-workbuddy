import { chmod, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { AVACommandError, fileSourceTypes, sourcePath } from './ava.js';
import {
  fileSourceType,
  sourceConfig,
  type FileSourceType,
  type SourceConfig,
} from './contracts.js';

// -----------------------------------------------------------------------------
// 本地文件、飞书链接与原生配置统一通过 stdin 加载
// -----------------------------------------------------------------------------

const remoteFileDisabled =
  'HTTP(S) file sources are temporarily disabled. Supply an authorized local file instead.';

export async function prepareSource(input: string | SourceConfig, type?: FileSourceType) {
  let config: SourceConfig;
  if (typeof input === 'string' && input.startsWith('@')) {
    if (type !== undefined) {
      throw new Error('type cannot be combined with a source config.');
    }
    const file = await sourcePath(input.slice(1), 'json-file');
    const content = await readFile(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // JSON 解析错误可能回显含密码的原文。
      throw new SyntaxError('The source config file must contain valid JSON.');
    }
    config = sourceConfig.parse(parsed);
  } else if (typeof input === 'string') {
    let inferred: SourceConfig['type'] | undefined;
    let path = input;
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      path = url.toString();
      if (/(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname)) {
        if (type !== undefined || !/^\/(base|wiki)\/[^/]+/.test(url.pathname)) {
          throw new Error('Use a Feishu/Lark Bitable base or wiki URL without a type override.');
        }
        inferred = 'feishu-bitable';
      } else {
        throw new Error(remoteFileDisabled);
      }
    } else {
      await sourcePath(path, type);
      inferred = fileSourceTypes[extname(path).toLowerCase()];
    }
    const sourceType = type === undefined ? inferred : fileSourceType.parse(type);
    if (!sourceType) {
      throw new Error('Cannot infer the source type. Provide a file source type explicitly.');
    }
    config = {
      type: sourceType,
      options: sourceType === 'feishu-bitable' ? { url: path } : { path },
    };
  } else {
    if (type !== undefined) {
      throw new Error('type cannot be combined with a source config.');
    }
    config = sourceConfig.parse(input);
  }

  // 上游尚未校验 SSH 主机密钥，修复前不向其传递隧道配置。
  if (Object.hasOwn(config.options, 'ssh')) {
    throw new Error(
      'Built-in SSH tunnels are temporarily disabled. Use a direct database connection.',
    );
  }
  if (config.type === 'feishu-bitable' && typeof config.options.url === 'string') {
    const url = new URL(config.options.url);
    if (url.protocol !== 'https:' || !/(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname)) {
      throw new Error('Feishu/Lark sources require an official HTTPS base or wiki URL.');
    }
  }
  let label: string = config.type;
  if (fileSourceType.safeParse(config.type).success) {
    const path = config.options.path;
    if (typeof path !== 'string' || !path) {
      throw new Error('File source options require a non-empty path.');
    }
    if (/^https?:\/\//i.test(path)) {
      // 禁止原生配置和 @配置文件绕过远程文件入口的限制。
      throw new Error(remoteFileDisabled);
    }
    config.options.path = await sourcePath(path, config.type as FileSourceType);
    label = basename(config.options.path as string);
  }
  // URL、连接串与完整配置可能含凭据，报告仅保存类型或本地文件名。
  return { config, label };
}

// -----------------------------------------------------------------------------
// 每个源单独暂存，避免上游的目录授权暴露原目录或共享临时目录
// -----------------------------------------------------------------------------

export async function isolateSource(config: SourceConfig) {
  // 短前缀为 AVA 的 Unix socket 路径预留空间。
  const directory = await mkdtemp(join(tmpdir(), 'aw-'));
  try {
    const path = config.options.path;
    if (fileSourceType.safeParse(config.type).success && typeof path === 'string') {
      const staged = join(directory, basename(path));
      if (config.type === 'sqlite') {
        // 一致性快照包含 WAL 中已提交的数据，不能只复制 SQLite 主文件。
        const { DatabaseSync } = await import('node:sqlite');
        const database = new DatabaseSync(path, { readOnly: true });
        try {
          database.exec(`VACUUM INTO '${staged.replaceAll("'", "''")}'`);
        } finally {
          database.close();
        }
      } else {
        await copyFile(path, staged);
      }
      await chmod(staged, 0o600);
      return { directory, config: { ...config, options: { ...config.options, path: staged } } };
    }
    return { directory, config };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

// -----------------------------------------------------------------------------
// 上游错误可能回显连接串，移除已知凭据后保留诊断和不确定状态
// -----------------------------------------------------------------------------

export function sourceErrorRedactor(config: SourceConfig) {
  const secrets = new Set<string>();
  const collect = (value: unknown, sensitive = false) => {
    if (typeof value === 'string') {
      if (value && (sensitive || /^(https?|mongodb(?:\+srv)?):\/\//i.test(value))) {
        secrets.add(value);
        if (/^Bearer\s+/i.test(value)) {
          secrets.add(value.replace(/^Bearer\s+/i, ''));
        }
        if (/^(https?|mongodb(?:\+srv)?):\/\//i.test(value)) {
          try {
            const url = new URL(value);
            if (url.password) {
              secrets.add(url.password);
              secrets.add(decodeURIComponent(url.password));
            }
            for (const [key, token] of url.searchParams) {
              if (token && /token|key|secret|signature|credential|password|auth/i.test(key)) {
                secrets.add(token);
              }
            }
          } catch {
            // 非 URL 连接串仍按完整值脱敏。
          }
        }
      }
    } else if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        collect(
          nested,
          sensitive || /password|secret|token|authorization|cookie|connection|headers/i.test(key),
        );
      }
    }
  };
  collect(config.options);
  const values = [...secrets].sort((a, b) => b.length - a.length);
  // 会话只保留脱敏所需的值，不保留完整数据源配置。
  return (error: unknown) => {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of values) {
      message = message.replaceAll(secret, '[redacted]');
    }
    return error instanceof AVACommandError
      ? new AVACommandError(message, error.uncertain)
      : new Error(message);
  };
}
