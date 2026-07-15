import { runTeam as runLegacyTeam } from '../team-legacy.js';
export async function runTeamReportCommand(argv) {
    const result = await runLegacyTeam(['status', ...argv.slice(1)]);
    return {
        ...result,
        command: 'team report',
        evidence: {
            ...(result.evidence ?? {}),
            action: 'report',
            reportProjection: result.evidence?.status ?? result.evidence ?? null,
            note: 'Report projection is separated from routing and backed by the read-only team status surface.'
        }
    };
}
