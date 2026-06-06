import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function getTemplatesDir(): string {
  const paths = [
    path.resolve(currentDir, '../templates'),
    path.resolve(currentDir, '../../templates'),
    path.resolve(currentDir, './templates')
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return path.resolve(currentDir, '../templates');
}

export function listTemplates(): string[] {
  const dir = getTemplatesDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith('-template.md'))
      .map((file) => file.replace(/-template\.md$/, ''));
  } catch {
    return [];
  }
}

export function loadTemplate(key: string): string {
  const dir = getTemplatesDir();
  const file = `${key}-template.md`;
  const filePath = path.join(dir, file);
  if (!existsSync(filePath)) {
    throw new Error(`Template not found: ${key} (expected at ${filePath})`);
  }
  return readFileSync(filePath, 'utf8');
}

export function applyIntent(templateText: string, fields: Record<string, unknown>): string {
  let content = templateText;
  for (const [key, value] of Object.entries(fields)) {
    const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    content = content.replace(placeholder, String(value ?? ''));
  }
  // 清除任何未被替換的 {{placeholder}}
  content = content.replace(/{{\s*[a-zA-Z0-9_-]+\s*}}/g, '');
  return content;
}
