export function buildContractImportRecoveryManifest(input) {
    const missing = input.validation.diagnostics
        .filter((entry) => entry.severity === 'error')
        .map((entry) => ({
        code: entry.code,
        field: entry.field ?? 'validators',
        detail: entry.message
    }));
    if (missing.length === 0) {
        return { ok: true, failClosed: false, missing: [], recoveryCommand: null };
    }
    const planRef = input.planPath && input.planPath.trim() ? input.planPath.trim() : '<plan-markdown-path>';
    const fields = [...new Set(missing.map((entry) => entry.field))].sort((a, b) => a.localeCompare(b));
    const recoveryCommand = `Add resolvable ${fields.join(', ')} to ${input.taskId}, then re-validate with `
        + `node atm.mjs tasks import --from ${planRef} --dry-run --json`;
    return { ok: false, failClosed: true, missing, recoveryCommand };
}
