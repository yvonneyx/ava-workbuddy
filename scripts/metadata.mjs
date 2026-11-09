import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const metadata = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
