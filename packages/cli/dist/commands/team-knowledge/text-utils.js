import { existsSync, readFileSync } from 'node:fs';
export function tokenize(value) {
    return Array.from(new Set(value.toLowerCase().split(/[^a-z0-9_.-]+/).map((entry) => entry.trim()).filter((entry) => entry.length >= 2)));
}
export function readSnippet(filePath, tokens) {
    if (!existsSync(filePath)) {
        return '';
    }
    const body = normalizeWhitespace(stripMarkdown(readFileSync(filePath, 'utf8')));
    if (tokens.length === 0) {
        return body.slice(0, 180);
    }
    const lower = body.toLowerCase();
    const first = tokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
    return body.slice(Math.max(0, first - 60), first + 180).trim();
}
export function stripMarkdown(value) {
    return value.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`[\]()]/g, ' ');
}
export function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
export function normalizePath(value) {
    return value.replace(/\\/g, '/');
}
export function stringOption(value) {
    const text = String(value ?? '').trim();
    return text || undefined;
}
