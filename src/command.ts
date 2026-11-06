import { execFile } from 'node:child_process';
import { avaCLI, checkEnvironment } from './environment.js';
import { root } from './metadata.js';

/** An uncertain command may still be executing inside AVA's separate session process. */
export class AVACommandError extends Error {
  constructor(message: string, public readonly uncertain = false) {
    super(message);
    this.name = 'AVACommandError';
  }
}

export function runCommand(args: string[], input?: string): Promise<unknown> {
  checkEnvironment();
  const env = { ...process.env };
  // WorkBuddy supplies the reasoning; AVA must not inherit model credentials.
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_MODEL;
  delete env.OPENAI_BASE_URL;
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [avaCLI, ...args], {
      env, cwd: root, timeout: 75_000, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new AVACommandError(error.killed
          ? 'AVA command timed out; the operation may still be running. Do not automatically retry or dispose this session.'
          : stderr.trim() || error.message,
        Boolean(error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')));
        return;
      }
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new AVACommandError('AVA returned invalid JSON; the command outcome is uncertain.', true)); }
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input ?? '');
  });
}
