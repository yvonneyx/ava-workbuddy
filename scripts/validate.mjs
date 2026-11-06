import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { root, metadata } from '../lib/metadata.js';

export async function validate() {
  const json = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
  const connector = await json('connector/connector-meta.json');
  const mcp = await json('connector/mcp.json');
  const plugin = await json('expert/.codebuddy-plugin/plugin.json');
  assert.equal(connector.type, 'mcp');
  assert.equal(connector.version, metadata.version);
  assert.equal(connector.minWorkbuddyVersion, '5.0.0');
  assert.match(connector.source, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(!('auth_mode' in connector), 'Local stdio has no remote authentication.');
  for (const field of ['name', 'name_en', 'description', 'description_zh', 'description_en']) assert(connector[field]?.trim(), `Missing ${field}`);
  for (const field of ['examples_zh', 'examples_en']) assert(connector[field].length >= 2 && connector[field].length <= 5);
  assert.deepEqual(Object.keys(mcp.mcpServers), [connector.source]);
  const config = mcp.mcpServers[connector.source];
  assert.equal(config.type, 'stdio'); assert.equal(config.command, 'npx');
  assert(config.args.includes(`--package=https://github.com/yvonneyx/ava-workbuddy/releases/download/v${metadata.version}/ava-workbuddy-${metadata.version}.tgz`));
  assert.deepEqual(config.runtime, { type: 'node', version: '>=22.13.0 <23' });
  assert.equal(plugin.version, metadata.version);
  assert.equal(plugin.name, plugin.plugin);
  assert.equal(plugin.expertType, 'agent');
  assert.equal(plugin.categoryId, '04-DataAI');
  assert.equal(plugin.tags.length, 3); assert.equal(plugin.quickPrompts.length, 3);
  assert.deepEqual(plugin.defaultInitPrompt, plugin.quickPrompts[0]);
  assert([...plugin.displayDescription.zh].length >= 40 && [...plugin.displayDescription.zh].length <= 50);
  assert.equal(plugin.dependencies.mcpServers, './.mcp.json');
  assert.deepEqual(plugin.skills, ['./skills/ava']);
  for (const agent of plugin.agents) {
    const source = await readFile(resolve(root, 'expert', agent), 'utf8');
    const frontmatter = parse(source.split('---')[1]);
    assert.equal(frontmatter.name, plugin.agentName);
    assert(!('tools' in frontmatter), 'WorkBuddy assigns expert tool permissions.');
    for (const field of ['description', 'displayName', 'profession']) assert(frontmatter[field]);
  }
  const skill = await readFile(join(root, 'skills/ava/SKILL.md'), 'utf8');
  const frontmatter = parse(skill.split('---')[1]);
  for (const field of ['name', 'display_name', 'display_name_en', 'description', 'description_zh', 'description_en', 'version', 'author']) assert(frontmatter[field], `Missing Skill ${field}`);
  assert.equal(frontmatter.version, metadata.version);
  for (const match of skill.matchAll(/\]\((references\/[^)]+)\)/g)) await access(join(root, 'skills/ava', match[1]));
  const avatar = await readFile(join(root, 'expert', plugin.avatar));
  assert.equal(avatar.subarray(1, 4).toString(), 'PNG');
  assert.equal(avatar.readUInt32BE(16), 512); assert.equal(avatar.readUInt32BE(20), 512);
  assert(avatar.length < 500 * 1024);
  return { valid: true, version: metadata.version, connector: connector.source, expert: plugin.name };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await validate(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
