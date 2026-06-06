/**
 * upgrade/scan.ts
 *
 * TASK-ASR-0014 — upgrade.ts complete split
 *
 * Evidence pattern scan flow (runUpgradeScan + detector report discovery).
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { scanEvidencePatternReports } from '../../../../core/dist/upgrade/evolution-draft.js';
import { CliError, makeResult, message, readJsonFile } from '../shared.js';
import { collectJsonFiles } from './path-helpers.js';
import { loadExplicitInputDocuments } from './proposal.js';
export async function runUpgradeScan(options) {
    const detectorReports = options.inputPaths.length > 0
        ? loadExplicitInputDocuments(options.cwd, options.inputPaths)
        : discoverDetectorReportDocuments(options.cwd);
    if (detectorReports.length === 0) {
        throw new CliError('ATM_EVIDENCE_SCAN_INPUTS_NOT_FOUND', 'Upgrade scan requires detector reports. Provide --input paths or stage detector reports under .atm/history/reports.', {
            exitCode: 2,
            details: { reportsRoot: path.join(options.cwd, '.atm', 'history', 'reports') }
        });
    }
    const scanReport = scanEvidencePatternReports({
        repositoryRoot: options.cwd,
        detectorReports: detectorReports.map((entry) => ({
            path: entry.path,
            document: entry.document
        })),
        proposedBy: options.proposedBy,
        proposedAt: options.proposedAt,
        dryRun: true
    });
    const proposalDrafts = scanReport.proposalDrafts;
    return makeResult({
        ok: true,
        command: 'upgrade',
        cwd: options.cwd,
        messages: [
            proposalDrafts.length === 0
                ? message('info', 'ATM_EVIDENCE_SCAN_EMPTY', 'Evidence scan completed with no proposal candidates.', {
                    scanId: scanReport.scanId,
                    detectorReportCount: scanReport.detectorReports.length
                })
                : message('info', 'ATM_EVIDENCE_SCAN_READY', 'Evidence scan produced dry-run proposal drafts.', {
                    scanId: scanReport.scanId,
                    proposalDraftCount: proposalDrafts.length,
                    proposalIds: proposalDrafts.map((draft) => draft.proposal.proposalId)
                })
        ],
        evidence: {
            scanReport,
            proposalDrafts,
            observationReport: scanReport.observation,
            dryRun: true,
            detectorReportCount: scanReport.detectorReports.length,
            proposalDraftCount: proposalDrafts.length,
            inputKinds: detectorReports.map((entry) => entry.document.schemaId),
            inputCount: detectorReports.length
        }
    });
}
// ─── Private helpers ───────────────────────────────────────────────────────
function discoverDetectorReportDocuments(cwd) {
    const reportsRoot = path.join(cwd, '.atm', 'history', 'reports');
    if (!existsSync(reportsRoot)) {
        return [];
    }
    const discoveredFiles = collectJsonFiles(reportsRoot).sort((left, right) => left.localeCompare(right));
    return discoveredFiles
        .map((filePath) => ({
        path: path.relative(cwd, filePath).replace(/\\/g, '/'),
        document: readJsonFile(filePath, 'ATM_EVIDENCE_SCAN_INPUT_NOT_FOUND')
    }))
        .filter((entry) => entry.document?.schemaId === 'atm.evidencePatternDetectorReport');
}
