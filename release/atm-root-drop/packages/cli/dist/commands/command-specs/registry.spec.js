import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.js';
export default defineCommandSpec({
    name: 'registry',
    summary: 'Backfill adopter-owned registry lineage from verified evidence.',
    positional: [
        { name: 'area', summary: 'Registry area. Currently: lineage.', required: true },
        { name: 'action', summary: 'Lineage action. Currently: backfill.', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--atom', value: 'atom-id', summary: 'Adopter-owned atom member to backfill.' },
        { flag: '--from', value: 'version', summary: 'Source version for registry-diff validation.' },
        { flag: '--to', value: 'version', summary: 'Target version for registry-diff validation.' },
        { flag: '--map', value: 'map-id', summary: 'Owning atomic map id.' },
        { flag: '--registry', value: 'path', summary: 'Registry document path. Defaults to atomic-registry.json.' },
        { flag: '--lineage-log', value: 'path', summary: 'Map lineage log carrying the member versionLineage evidence.' },
        { flag: '--equivalence', value: 'path', summary: 'Passing map equivalence report evidence.' },
        { flag: '--propagation', value: 'path', summary: 'Passing propagation report evidence.' },
        { flag: '--review', value: 'path', summary: 'Review advisory report evidence.' },
        { flag: '--review-advisory', value: 'path', summary: 'Alias for --review.' },
        { flag: '--human-review', value: 'path', summary: 'Approved human review decision evidence.' },
        { flag: '--actor', value: 'id', summary: 'Actor recorded in closeout evidence.' },
        { flag: '--at', value: 'iso-date', summary: 'Deterministic timestamp for patch and closeout evidence.' },
        { flag: '--dry-run', summary: 'Emit the deterministic patch without mutating host files.' },
        { flag: '--apply', summary: 'Apply the lineage backfill after all required evidence validates.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs registry lineage backfill --atom ATM-NPCBRAIN-0002 --from 0.1.0 --to 0.1.1 --map ATM-MAP-0001 --lineage-log atomic_workbench/maps/ATM-MAP-0001/lineage-log.json --dry-run --json',
        'node atm.mjs registry lineage backfill --atom ATM-NPCBRAIN-0002 --from 0.1.0 --to 0.1.1 --map ATM-MAP-0001 --lineage-log atomic_workbench/maps/ATM-MAP-0001/lineage-log.json --equivalence atomic_workbench/maps/ATM-MAP-0001/map.equivalence.report.json --propagation atomic_workbench/maps/ATM-MAP-0001/propagation.report.json --review atomic_workbench/maps/ATM-MAP-0001/review-advisory.report.json --human-review atomic_workbench/maps/ATM-MAP-0001/human-review.decision.json --apply --json'
    ]
});
