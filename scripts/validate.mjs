import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { root, metadata } from '../lib/metadata.js';

// -----------------------------------------------------------------------------
// 分发资产校验
// -----------------------------------------------------------------------------

export async function validate() {
  const json = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
  const connector = await json('connector/connector-meta.json');
  const mcp = await json('connector/mcp.json');
  const plugin = await json('expert/.codebuddy-plugin/plugin.json');

  // -----------------------------------------------------------------------------
  // 连接器与 MCP 安装配置
  // -----------------------------------------------------------------------------

  assert.equal(connector.type, 'mcp');
  assert.equal(connector.version, metadata.version);
  assert.equal(connector.minWorkbuddyVersion, '5.0.0');
  assert.match(connector.source, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(!('auth_mode' in connector), 'Local stdio has no remote authentication.');
  for (const field of ['name', 'name_en', 'description', 'description_zh', 'description_en']) {
    assert(connector[field]?.trim(), `Missing ${field}`);
  }
  for (const field of ['examples_zh', 'examples_en']) {
    assert(connector[field].length >= 2 && connector[field].length <= 5);
  }
  assert.deepEqual(Object.keys(mcp.mcpServers), [connector.source]);
  const config = mcp.mcpServers[connector.source];
  assert.equal(config.type, 'stdio');
  assert.equal(config.command, 'npx');
  assert(
    config.args.includes(
      `--package=https://github.com/yvonneyx/ava-workbuddy/releases/download/v${metadata.version}/ava-workbuddy-${metadata.version}.tgz`,
    ),
  );
  assert.deepEqual(config.runtime, { type: 'node', version: '>=22.13.0 <23' });

  // -----------------------------------------------------------------------------
  // 专家配置与 Agent 声明
  // -----------------------------------------------------------------------------

  assert.equal(plugin.version, metadata.version);
  assert.equal(plugin.name, plugin.plugin);
  assert.equal(plugin.expertType, 'agent');
  assert.equal(plugin.categoryId, '04-DataAI');
  assert.equal(plugin.tags.length, 3);
  assert.equal(plugin.quickPrompts.length, 3);
  assert.deepEqual(plugin.defaultInitPrompt, plugin.quickPrompts[0]);
  assert(
    [...plugin.displayDescription.zh].length >= 40 &&
      [...plugin.displayDescription.zh].length <= 50,
  );
  assert.equal(plugin.dependencies.mcpServers, './.mcp.json');
  assert(!('skills' in plugin), 'Analysis guidance is supplied by MCP.');
  for (const agent of plugin.agents) {
    const source = await readFile(resolve(root, 'expert', agent), 'utf8');
    const frontmatter = parse(source.split('---')[1]);
    assert.equal(frontmatter.name, plugin.agentName);
    assert.deepEqual(frontmatter.displayName, plugin.displayName);
    assert.deepEqual(frontmatter.profession, plugin.profession);
    assert(!('skills' in frontmatter), 'The expert uses MCP tools without a separate Skill.');
    assert(!('tools' in frontmatter), 'WorkBuddy assigns expert tool permissions.');
    for (const field of ['description', 'displayName', 'profession']) {
      assert(frontmatter[field]);
    }
  }

  // -----------------------------------------------------------------------------
  // 静态资源
  // -----------------------------------------------------------------------------

  await access(join(root, 'public/artifact.html'));
  await access(join(root, 'public/icon.svg'));
  const avatar = await readFile(join(root, 'public', plugin.avatar));
  assert.equal(avatar.subarray(1, 4).toString(), 'PNG');
  assert.equal(avatar.readUInt32BE(16), 512);
  assert.equal(avatar.readUInt32BE(20), 512);
  assert(avatar.length < 500 * 1024);
  return {
    valid: true,
    version: metadata.version,
    connector: connector.source,
    expert: plugin.name,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await validate(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
