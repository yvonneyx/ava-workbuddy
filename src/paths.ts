import { access, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { metadata } from './metadata.js';

export async function sourcePath(path: string) {
  if (!isAbsolute(path)) throw new Error('Provide an absolute path to the local file supplied by the user.');
  if (!['.csv', '.xlsx'].includes(extname(path).toLowerCase())) throw new Error(`v${metadata.version} accepts local CSV and XLSX files only.`);
  const resolved = await realpath(path);
  if (!['.csv', '.xlsx'].includes(extname(resolved).toLowerCase())) throw new Error('The resolved source must also be a CSV or XLSX file.');
  if (!(await stat(resolved)).isFile()) throw new Error('The source must be a regular file.');
  await access(resolved);
  return resolved;
}

export function outputPath(path: string) {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.html') throw new Error('Provide an absolute output path ending in .html. Existing files are not overwritten.');
  return path;
}

