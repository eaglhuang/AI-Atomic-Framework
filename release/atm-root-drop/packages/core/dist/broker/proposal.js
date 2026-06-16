import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// 使用動態 require 載入 ajv，與 schema-validator.ts 保持一致，
// 讓 broker proposal 在 one-file release cache 環境下也能正確解析。
const _require = createRequire(import.meta.url);
function loadAjv() {
    try {
        return { Ajv2020: _require('ajv/dist/2020.js') };
    }
    catch {
        const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
        return { Ajv2020: cwdRequire('ajv/dist/2020.js') };
    }
}
export const defaultBrokerProposalStoreRelativePath = path.join('.atm', 'runtime', 'broker-proposals.json');
const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../schemas/governance/patch-proposal.schema.json');
let proposalSchemaValidator = null;
export function loadBrokerProposalStore(filePath) {
    if (!existsSync(filePath)) {
        return emptyBrokerProposalStore();
    }
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        const proposals = Array.isArray(parsed.proposals)
            ? parsed.proposals.filter((proposal) => isPatchProposal(proposal))
            : [];
        return {
            schemaId: 'atm.brokerProposalStore.v1',
            specVersion: '0.1.0',
            generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : new Date().toISOString(),
            proposals
        };
    }
    catch {
        return emptyBrokerProposalStore();
    }
}
export function saveBrokerProposalStore(filePath, document) {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}
export function upsertBrokerProposalStore(document, proposal) {
    const proposals = document.proposals.filter((entry) => entry.proposalId !== proposal.proposalId);
    return {
        ...document,
        generatedAt: new Date().toISOString(),
        proposals: [...proposals, proposal]
    };
}
export function listBrokerProposalSummaries(document) {
    return [...document.proposals]
        .sort((left, right) => left.proposalId.localeCompare(right.proposalId))
        .map((proposal) => ({
        proposalId: proposal.proposalId,
        taskId: proposal.taskId,
        targetFile: proposal.targetFile,
        atomRefCount: proposal.atomRefs.length,
        anchorCount: proposal.anchors.length,
        validatorCount: proposal.validators.length
    }));
}
export function findBrokerProposal(document, proposalId) {
    return document.proposals.find((proposal) => proposal.proposalId === proposalId) ?? null;
}
export function readBrokerProposalFile(filePath) {
    if (!existsSync(filePath)) {
        throw new Error(`Proposal file not found: ${filePath}`);
    }
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
export function validateBrokerProposal(proposal, options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const issues = [];
    const proposalId = typeof proposal?.proposalId === 'string' ? proposal.proposalId : '<unknown-proposal>';
    const schemaValidator = getBrokerProposalSchemaValidator();
    if (!schemaValidator(proposal)) {
        issues.push({
            kind: 'schema',
            detail: formatSchemaErrors(schemaValidator.errors)
        });
    }
    if (!Array.isArray(proposal.atomRefs) || proposal.atomRefs.length === 0) {
        issues.push({
            kind: 'missing-atom-refs',
            detail: 'Proposal must include at least one atom ref.'
        });
    }
    if (!Array.isArray(proposal.anchors) || proposal.anchors.length === 0 || hasAmbiguousAnchors(proposal.anchors)) {
        issues.push({
            kind: 'ambiguous-anchors',
            detail: 'Proposal anchors must be present and uniquely identify the patch surface.'
        });
    }
    const resolvedTargetFile = path.resolve(cwd, String(proposal.targetFile ?? ''));
    if (isPathOutsideRoot(cwd, resolvedTargetFile)) {
        issues.push({
            kind: 'out-of-scope-target-file',
            detail: `Target file is outside the repository root: ${proposal.targetFile}`
        });
    }
    const currentBaseCommit = readGitHeadCommit(cwd);
    if (!currentBaseCommit || currentBaseCommit !== proposal.baseCommit) {
        issues.push({
            kind: 'stale-base-commit',
            detail: currentBaseCommit
                ? `Proposal base commit ${proposal.baseCommit} does not match repository HEAD ${currentBaseCommit}.`
                : 'Unable to read repository HEAD commit for base commit validation.'
        });
    }
    let currentFileHash = null;
    if (!isPathOutsideRoot(cwd, resolvedTargetFile) && existsSync(resolvedTargetFile)) {
        currentFileHash = hashFileContents(resolvedTargetFile);
        if (currentFileHash !== proposal.fileBeforeHash) {
            issues.push({
                kind: 'file-hash-mismatch',
                detail: `Target file hash ${currentFileHash} does not match proposal fileBeforeHash ${proposal.fileBeforeHash}.`
            });
        }
    }
    else if (!isPathOutsideRoot(cwd, resolvedTargetFile)) {
        issues.push({
            kind: 'file-hash-mismatch',
            detail: `Target file does not exist: ${proposal.targetFile}`
        });
    }
    return {
        ok: issues.length === 0,
        proposalId,
        cwd,
        targetFile: proposal.targetFile,
        resolvedTargetFile: isPathOutsideRoot(cwd, resolvedTargetFile) ? null : resolvedTargetFile,
        currentBaseCommit,
        currentFileHash,
        issues
    };
}
function emptyBrokerProposalStore() {
    return {
        schemaId: 'atm.brokerProposalStore.v1',
        specVersion: '0.1.0',
        generatedAt: new Date().toISOString(),
        proposals: []
    };
}
function isPatchProposal(value) {
    return Boolean(value)
        && typeof value === 'object'
        && typeof value.proposalId === 'string'
        && typeof value.taskId === 'string';
}
function hasAmbiguousAnchors(anchors) {
    const seen = new Set();
    for (const anchor of anchors) {
        const key = `${anchor.kind}::${anchor.hint}`;
        if (seen.has(key)) {
            return true;
        }
        seen.add(key);
    }
    return false;
}
function isPathOutsideRoot(root, candidatePath) {
    const relative = path.relative(path.resolve(root), path.resolve(candidatePath));
    return relative.startsWith('..') || path.isAbsolute(relative);
}
function readGitHeadCommit(cwd) {
    const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', 'HEAD'], {
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        return null;
    }
    const head = String(result.stdout ?? '').trim();
    return head.length > 0 ? head : null;
}
function hashFileContents(filePath) {
    return `sha256:${crypto.createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}
function getBrokerProposalSchemaValidator() {
    if (!proposalSchemaValidator) {
        const { Ajv2020 } = loadAjv();
        const AjvConstructor = Ajv2020.default ?? Ajv2020;
        const ajv = new AjvConstructor({ allErrors: true, strict: false });
        const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
        proposalSchemaValidator = ajv.compile(schema);
    }
    return proposalSchemaValidator;
}
function formatSchemaErrors(errors) {
    if (!errors || errors.length === 0) {
        return 'Proposal schema validation failed.';
    }
    return errors
        .map((error) => `${error.instancePath || '/'} ${error.message || 'invalid'}`.trim())
        .join('; ');
}
