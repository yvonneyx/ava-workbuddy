import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { metadata } from './metadata.js';

const require = createRequire(import.meta.url);
const avaMetadataPath = require.resolve('@antv/ava/package.json');
const avaMetadata = JSON.parse(readFileSync(avaMetadataPath, 'utf8')) as { version: string; bin: { ava: string } };
export const avaCLI = resolve(dirname(avaMetadataPath), avaMetadata.bin.ava);

export function checkEnvironment(nodeVersion = process.versions.node, platform: string = process.platform) {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 13))) throw new Error('Node.js 22.13.0 or newer is required.');
  if (!['darwin', 'linux'].includes(platform)) throw new Error(`AVA sessions currently support macOS/Linux only. Windows is not supported in v${metadata.version}.`);
  if (avaMetadata.version !== metadata.dependencies['@antv/ava']) throw new Error('Installed AVA does not match the pinned version. Reinstall this integration.');
  return { ready: true, integrationVersion: metadata.version, avaVersion: avaMetadata.version, nodeVersion, platform, authentication: 'none-local-stdio', chartPreviewVerified: false };
}

