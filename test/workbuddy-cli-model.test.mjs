import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliResult } from '../scripts/workbuddy-cli-model.mjs';

// Shapes captured from the real CLI probe; credentials and session IDs omitted.
const encode = (...events) => events.map(event => JSON.stringify(event)).join('\n');
const init = { type: 'system', subtype: 'init', model: 'custom-local:deepseek-v4-pro' };
const success = { type: 'result', subtype: 'success', is_error: false, result: 'AVA_CLI_OK_20261106' };

test('CLI parser rejects authentication failure even when the process exits successfully', () => {
  const stdout = encode({ type: 'result', subtype: 'error_during_execution', is_error: true,
    errors: ['Authentication required. Please use /login command to sign in to your account'] });
  assert.throws(() => parseCliResult(stdout, 'default-model'), /generation failed/);
});

test('CLI parser verifies model selection and rejects a mismatch or tool-using response', () => {
  const stdout = encode(init, success);
  assert.equal(parseCliResult(stdout, 'custom-local:deepseek-v4-pro').text, 'AVA_CLI_OK_20261106');
  assert.throws(() => parseCliResult(stdout, 'other-model'), /requested model/);
  assert.throws(() => parseCliResult(encode(init, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }, success), init.model), /tool-using/);
});
