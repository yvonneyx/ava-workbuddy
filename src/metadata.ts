import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
  homepage: string;
  dependencies: Record<string, string>;
};
