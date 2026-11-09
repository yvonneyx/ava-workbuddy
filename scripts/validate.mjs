import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { root, metadata } from './metadata.mjs';

// -----------------------------------------------------------------------------
// 专家配置、上游引用与唯一资源源校验
// -----------------------------------------------------------------------------

export async function validate() {
  const json = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
  const plugin = await json('expert/.codebuddy-plugin/plugin.json');
  const lock = await json('npm-shrinkwrap.json');
  assert.equal(lock.version, metadata.version);
  assert.equal(lock.packages[''].version, metadata.version);
  assert.equal(metadata.private, true);
  for (const field of ['bin', 'main', 'types', 'exports', 'dependencies']) {
    assert(!(field in metadata), `Unexpected runtime field: ${field}`);
  }
  assert.equal(plugin.version, metadata.version);
  assert.match(plugin.name, /^[a-z]+(?:-[a-z]+)*$/);
  assert(plugin.description?.trim() && plugin.author?.name?.trim() && plugin.author?.email?.trim());
  assert.equal(plugin.name, plugin.plugin);
  assert.equal(plugin.expertType, 'agent');
  assert.equal(plugin.categoryId, '04-DataAI');
  assert.equal(plugin.tags.length, 3);
  assert.equal(plugin.quickPrompts.length, 3);
  for (const localized of [
    plugin.displayName,
    plugin.profession,
    plugin.displayDescription,
    plugin.defaultInitPrompt,
    ...plugin.tags,
    ...plugin.quickPrompts,
  ]) {
    for (const language of ['zh', 'en']) assert(localized[language]?.trim(), `Missing ${language}`);
  }
  assert.deepEqual(plugin.defaultInitPrompt, plugin.quickPrompts[0]);
  assert(
    [...plugin.displayDescription.zh].length >= 40 &&
      [...plugin.displayDescription.zh].length <= 50,
  );
  assert(!('dependencies' in plugin), 'The expert uses the bundled AVA Skill and CLI.');
  assert(!('mcpServers' in plugin), 'The expert must not auto-load the legacy MCP.');
  assert.deepEqual(plugin.skills, ['./skills/ava']);
  const skill = await json('expert/ava-skill.json');
  assert.equal(skill.url, 'https://github.com/antvis/AVA/tree/codex/ava-skill-reports/skills/ava');
  assert.match(skill.commit, /^[a-f0-9]{40}$/);
  assert.match(skill.sha256, /^[a-f0-9]{64}$/);
  assert.equal(plugin.agents.length, 1);
  for (const agent of plugin.agents) {
    const source = await readFile(resolve(root, 'expert', agent), 'utf8');
    const frontmatter = parse(source.split('---')[1]);
    assert.equal(frontmatter.name, plugin.agentName);
    assert.equal(agent, `./agents/${frontmatter.name}.md`);
    assert.deepEqual(frontmatter.displayName, plugin.displayName);
    assert.deepEqual(frontmatter.profession, plugin.profession);
    assert.deepEqual(frontmatter.skills, ['ava']);
    assert(!('tools' in frontmatter), 'WorkBuddy assigns expert tool permissions.');
    assert(frontmatter.description?.trim());
  }
  assert((await readFile(join(root, 'public/expert-icon.svg'), 'utf8')).includes('<svg'));
  const avatar = await readFile(join(root, 'public', plugin.avatar));
  assert.equal(avatar.subarray(1, 4).toString(), 'PNG');
  assert.equal(avatar.readUInt32BE(16), 512);
  assert.equal(avatar.readUInt32BE(20), 512);
  assert(avatar.length < 500 * 1024);
  return { valid: true, version: metadata.version, expert: plugin.name, skillCommit: skill.commit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await validate(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
