export function normalizeMarkdownPathDeclaration(value) {
    let normalized = value.trim().replace(/\\/g, '/');
    if (normalized.length >= 2 && normalized.startsWith('`') && normalized.endsWith('`')) {
        normalized = normalized.slice(1, -1).trim();
    }
    return normalized;
}
