import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// -----------------------------------------------------------------------------
// 运行代码与打包脚本共享包信息
// -----------------------------------------------------------------------------

export const root = fileURLToPath(new URL('../', import.meta.url));
export const metadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  name: string;
  version: string;
  homepage: string;
  dependencies: Record<string, string>;
};
