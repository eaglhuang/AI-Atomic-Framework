const atomIdPattern = /^ATM-[A-Z][A-Z0-9]*-\d{4}$/;
const mapIdPattern = /^ATM-MAP-\d{4}$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const urnPattern = /^urn:atm:([a-z][a-z0-9-]*):([^@\s]+)(?:@(\d+\.\d+\.\d+))?$/;
const legacyUriPattern = /^legacy:\/\/([^#\s]+)(?:#(L\d+(?:-L?\d+)?))?$/;
const supportedNodeKinds = new Set(['atom', 'map', 'police', 'behavior']);

export class AtmUrnError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AtmUrnError';
    this.code = code;
    this.details = details;
  }
}

export function inferAtmNodeKind(canonicalId) {
  const normalizedId = normalizeCanonicalId(canonicalId);
  if (mapIdPattern.test(normalizedId)) {
    return 'map';
  }
  if (!atomIdPattern.test(normalizedId)) {
    throw new AtmUrnError('ATM_CANONICAL_ID_INVALID', 'Canonical ATM ID is invalid.', { canonicalId });
  }
  if (normalizedId.startsWith('ATM-POLICE-')) {
    return 'police';
  }
  if (normalizedId.startsWith('ATM-BEHAVIOR-')) {
    return 'behavior';
  }
  return 'atom';
}

export function formatAtmUrn(input) {
  const nodeKind = normalizeNodeKind(input?.nodeKind ?? input?.kind ?? inferAtmNodeKind(input?.canonicalId ?? input?.atomId ?? input?.mapId));
  const canonicalId = normalizeCanonicalId(input?.canonicalId ?? input?.atomId ?? input?.mapId);
  const version = normalizeOptionalVersion(input?.version ?? input?.atomVersion ?? input?.mapVersion ?? input?.currentVersion ?? null);
  assertCanonicalIdMatchesKind(canonicalId, nodeKind);
  return `urn:atm:${nodeKind}:${canonicalId}${version ? `@${version}` : ''}`;
}

export function parseAtmUrn(value) {
  const text = String(value || '').trim();
  const match = text.match(urnPattern);
  if (!match) {
    throw new AtmUrnError('ATM_URN_INVALID', 'ATM URN must match urn:atm:<nodeKind>:<canonicalId>[@<semver>].', { value });
  }
  const nodeKind = normalizeNodeKind(match[1]);
  const canonicalId = normalizeCanonicalId(match[2]);
  const version = normalizeOptionalVersion(match[3] ?? null);
  assertCanonicalIdMatchesKind(canonicalId, nodeKind);
  return {
    urn: formatAtmUrn({ nodeKind, canonicalId, version }),
    nodeKind,
    canonicalId,
    version
  };
}

export function normalizeAtmNodeRef(value, options = {}) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('urn:atm:')) {
      return parseAtmUrn(text);
    }
    const nodeKind = options.nodeKind ? normalizeNodeKind(options.nodeKind) : inferAtmNodeKind(text);
    const canonicalId = normalizeCanonicalId(text);
    const version = normalizeOptionalVersion(options.version ?? null);
    assertCanonicalIdMatchesKind(canonicalId, nodeKind);
    return {
      urn: formatAtmUrn({ nodeKind, canonicalId, version }),
      nodeKind,
      canonicalId,
      version
    };
  }

  const canonicalId = value?.canonicalId ?? value?.atomId ?? value?.mapId;
  const nodeKind = value?.nodeKind ?? value?.kind ?? inferAtmNodeKind(canonicalId);
  const version = value?.version ?? value?.atomVersion ?? value?.mapVersion ?? value?.currentVersion ?? null;
  const normalizedKind = normalizeNodeKind(nodeKind);
  const normalizedId = normalizeCanonicalId(canonicalId);
  const normalizedVersion = normalizeOptionalVersion(version);
  assertCanonicalIdMatchesKind(normalizedId, normalizedKind);
  return {
    urn: formatAtmUrn({ nodeKind: normalizedKind, canonicalId: normalizedId, version: normalizedVersion }),
    nodeKind: normalizedKind,
    canonicalId: normalizedId,
    version: normalizedVersion
  };
}

export function isAtmUrn(value) {
  try {
    parseAtmUrn(value);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeNodeKind(value) {
  const nodeKind = String(value || '').trim().toLowerCase();
  if (!supportedNodeKinds.has(nodeKind)) {
    throw new AtmUrnError('ATM_NODE_KIND_INVALID', 'ATM node kind is unsupported.', { nodeKind: value });
  }
  return nodeKind;
}

function normalizeCanonicalId(value) {
  const canonicalId = String(value || '').trim().toUpperCase();
  if (!canonicalId) {
    throw new AtmUrnError('ATM_CANONICAL_ID_REQUIRED', 'Canonical ATM ID is required.');
  }
  return canonicalId;
}

function normalizeOptionalVersion(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const version = String(value).trim();
  if (!semverPattern.test(version)) {
    throw new AtmUrnError('ATM_VERSION_INVALID', 'ATM URN version must be a semver string.', { version: value });
  }
  return version;
}

function assertCanonicalIdMatchesKind(canonicalId, nodeKind) {
  if (nodeKind === 'map') {
    if (!mapIdPattern.test(canonicalId)) {
      throw new AtmUrnError('ATM_MAP_ID_INVALID', 'ATM map URN must use ATM-MAP-0000 canonical IDs.', { canonicalId });
    }
    return;
  }
  if (!atomIdPattern.test(canonicalId) || mapIdPattern.test(canonicalId)) {
    throw new AtmUrnError('ATM_ATOM_ID_INVALID', 'ATM atom-like URN must use ATM-{bucket}-0000 canonical IDs.', { canonicalId, nodeKind });
  }
}

export function parseLegacyUri(value) {
  const text = String(value || '').trim();
  const match = text.match(legacyUriPattern);
  if (!match) {
    throw new AtmUrnError('ATM_LEGACY_URI_INVALID', 'Legacy URI must match legacy://<repository>/<path>[#Lx[-Ly]].', { value });
  }

  const locator = String(match[1] || '').trim();
  const slashIndex = locator.indexOf('/');
  const repositoryAlias = slashIndex >= 0 ? locator.slice(0, slashIndex) : locator;
  const relativePath = slashIndex >= 0 ? locator.slice(slashIndex + 1) : '';
  if (!repositoryAlias) {
    throw new AtmUrnError('ATM_LEGACY_URI_REPOSITORY_REQUIRED', 'Legacy URI requires repository alias.', { value });
  }

  const fragment = match[2] ?? null;
  let lineStart = null;
  let lineEnd = null;
  if (fragment) {
    const lineMatch = fragment.match(/^L(\d+)(?:-L?(\d+))?$/);
    if (!lineMatch) {
      throw new AtmUrnError('ATM_LEGACY_URI_FRAGMENT_INVALID', 'Legacy URI line fragment must match #Lx or #Lx-Ly.', { value });
    }
    lineStart = Number.parseInt(lineMatch[1], 10);
    lineEnd = Number.parseInt(lineMatch[2] ?? lineMatch[1], 10);
  }

  return {
    uri: text,
    scheme: 'legacy',
    repositoryAlias,
    relativePath,
    fragment,
    lineStart,
    lineEnd
  };
}

export function isLegacyUri(value) {
  try {
    parseLegacyUri(value);
    return true;
  } catch (_error) {
    return false;
  }
}