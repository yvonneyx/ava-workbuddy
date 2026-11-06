import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
const cliRoot = process.env.WORKBUDDY_CLI_ROOT ?? '/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli';

export function parseCliResult(stdout, requestedModel) {
  const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const result = events.findLast(event => event.type === 'result');
  if (!result || result.is_error || result.subtype !== 'success') {
    throw new Error(`WorkBuddy CLI generation failed: ${JSON.stringify(result?.errors ?? result?.subtype ?? 'no result')}`);
  }
  if (events.some(event => event.message?.content?.some(part => part.type === 'tool_use'))) {
    throw new Error('The text-only bridge refuses tool-using responses.');
  }
  const init = events.find(event => event.type === 'system' && event.subtype === 'init');
  if (init?.model !== requestedModel) throw new Error('WorkBuddy CLI did not select the requested model.');
  if (typeof result.result !== 'string' || !result.result.trim()) throw new Error('WorkBuddy CLI returned no text.');
  const actualModel = events.findLast(event => event.type === 'assistant')?.message?.model;
  return { text: result.result, actualModel, usage: result.usage, modelUsage: result.modelUsage };
}

// shortcut: non-streaming, text-only, one CLI session per generation; this is a local probe, not a released provider.
export function workbuddyCliModel({ cwd, model, onCall = async () => {} }) {
  let index = 0;
  const configDirectory = process.env.WORKBUDDY_CONFIG_DIR ?? join(homedir(), '.workbuddy-ai');
  return {
    specificationVersion: 'v3', provider: 'workbuddy-cli', modelId: model, supportedUrls: {},
    async doGenerate(options) {
      if (options.tools?.length) throw new Error('The minimal CLI bridge supports text generation only.');
      const system = [], messages = [];
      for (const message of options.prompt) {
        if (message.role === 'system') { system.push(message.content); continue; }
        if (!['user', 'assistant'].includes(message.role) || message.content.some(part => part.type !== 'text')) {
          throw new Error('The minimal CLI bridge accepts text-only user and assistant messages.');
        }
        messages.push({ role: message.role, content: message.content.map(part => part.text).join('\n') });
      }
      const prompt = messages.length === 1 && messages[0].role === 'user'
        ? messages[0].content : `Respond to the last message in this conversation:\n${JSON.stringify(messages)}`;
      const args = [
        `${cliRoot}/dist/codebuddy-lite-wb.mjs`, '-p', '--output-format', 'stream-json', '--verbose',
        '--model', model, '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--setting-sources', 'user', '--no-session-persistence', '--max-turns', '1',
        '--system-prompt', system.join('\n\n') || 'Follow the user request precisely, including the requested output language. Return only the requested text. For JSON responses, omit absent optional properties; optional string properties must not be null. Do not use tools.', prompt,
      ];
      const call = ++index;
      const { stdout, stderr } = await execute(process.execPath, args, {
        cwd, signal: options.abortSignal, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env, WORKBUDDY_CONFIG_DIR: configDirectory,
          CODEBUDDY_CONFIG_DIR: configDirectory, WORKBUDDY_DATA_FOLDER_NAME: '.workbuddy-ai',
          ACC_PRODUCT_CONFIG_PATH: `${cliRoot}/product.json`, DISABLE_AUTOUPDATER: '1', CODEBUDDY_DISABLE_CRON: '1',
        },
      });
      await onCall({ index: call, prompt, system, stdout, stderr });
      const response = parseCliResult(stdout, model);
      return {
        content: [{ type: 'text', text: response.text }], finishReason: { unified: 'stop', raw: 'cli-success' },
        usage: { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined } },
        response: { modelId: response.actualModel ?? model }, warnings: [],
      };
    },
    async doStream() { throw new Error('Streaming is outside the minimal WorkBuddy CLI probe.'); },
  };
}
