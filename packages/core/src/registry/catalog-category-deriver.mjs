function normalizeStringArray(values) {
  return Array.from(new Set((values || []).filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function normalizePathList(value) {
  if (!value) {
    return [];
  }
  const entries = Array.isArray(value) ? value : [value];
  return normalizeStringArray(entries.map((entry) => String(entry).replace(/\\/g, '/')));
}

function extractPluginFamily(atomId, codePaths) {
  const atomMatch = String(atomId || '').match(/^atom\.plugin-([^\.]+)/i);
  if (atomMatch) {
    return atomMatch[1];
  }

  for (const codePath of codePaths) {
    const pathMatch = codePath.match(/^packages\/plugin-([^/]+)/i);
    if (pathMatch) {
      return pathMatch[1];
    }
  }

  return '';
}

export function deriveRegistryCatalogCategory(entry, specDocument = {}) {
  const atomId = String(entry?.atomId || specDocument?.id || '').trim();
  const tags = normalizeStringArray(specDocument?.tags);
  const codePaths = normalizePathList(entry?.location?.codePaths || entry?.selfVerification?.sourcePaths?.code);

  if (atomId === 'atom.core-seed') {
    return 'core / seed / self-descriptor';
  }

  const pluginFamily = extractPluginFamily(atomId, codePaths);
  if (pluginFamily) {
    const parts = ['plugin', pluginFamily];
    if (tags.includes('governance')) {
      parts.push('governance');
    }
    return parts.join(' / ');
  }

  if (tags.includes('registry')) {
    return tags.includes('alpha0') ? 'registry / alpha0' : 'registry';
  }

  if (codePaths.some((codePath) => codePath.startsWith('packages/core/'))) {
    return tags.includes('seed') ? 'core / seed' : 'core';
  }

  if (tags.length > 0) {
    return tags.slice(0, 2).join(' / ');
  }

  return 'uncategorized';
}