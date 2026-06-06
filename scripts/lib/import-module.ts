import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function importModuleFromPath<T = unknown>(absolutePath: string): Promise<T> {
  return import(pathToFileURL(path.resolve(absolutePath)).href) as Promise<T>;
}
