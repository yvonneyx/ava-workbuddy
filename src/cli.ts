#!/usr/bin/env node
import { metadata } from './metadata.js';

// -----------------------------------------------------------------------------
// 命令分发；stdio 模式由服务自身管理输出
// -----------------------------------------------------------------------------

try {
  const [command = 'serve', ...args] = process.argv.slice(2);
  let result;
  if (command === '--version' && args.length === 0) {
    result = metadata.version;
  } else if (command === 'check' && args.length === 0) {
    result = (await import('./ava.js')).checkEnvironment();
  } else if (command === 'serve' && args.length === 0) {
    await (await import('./server.js')).serve();
  } else if (command === '--help' && args.length === 0) {
    result = 'ava-workbuddy [serve | check | --version]';
  } else {
    throw new Error('Unknown command or arguments. Run ava-workbuddy --help.');
  }
  if (result !== undefined) {
    process.stdout.write(
      `${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}\n`,
    );
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
