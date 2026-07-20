import assert from 'node:assert/strict';
import { runGuide } from '../../packages/cli/src/commands/guide.ts';
import { compactNextRouteResult } from '../../packages/cli/src/commands/next/result-compaction.ts';

const firstLayer = runGuide(['first-layer', '--json']);
assert.equal(firstLayer.ok, true);
const evidence = firstLayer.evidence as any;
assert.equal(evidence.schemaId, 'atm.firstLayerCommandContract.v1');

interface RouteRow {
  readonly command: string;
  readonly negativeCase: string;
}

const routes = new Map<string, RouteRow>(evidence.routeMatrix.map((row: any) => [row.intent, row]));
assert.equal(routes.get('audit')?.command, 'node atm.mjs tasks audit --json');
assert.equal(routes.get('backlog')?.command, 'node atm.mjs guide first-layer --json');
assert.equal(routes.get('optimization')?.command, 'node atm.mjs guide first-layer --json');
assert.equal(routes.get('create')?.command, 'node atm.mjs guide create-atom --json');
assert.match(routes.get('audit')?.negativeCase ?? '', /Must not route to create-atom/);
assert.match(evidence.commonCommands.promptScopedNext, /next --prompt/);
assert.match(evidence.commonCommands.fullNext, /--verbose/);
assert.match(evidence.windowsSafeExamples.forbiddenPattern, /PowerShell range indexing/);

const compacted = compactNextRouteResult({
  ok: true,
  messages: [
    {
      code: 'ATM_CHANNEL_PLAYBOOK_REQUIRED',
      data: {
        channel: 'normal',
        steps: ['duplicated'],
        doNot: ['duplicated'],
        commandSequence: ['duplicated'],
        governedGitEntrypoint: { preferredCommand: 'duplicated' }
      }
    }
  ],
  evidence: {
    nextAction: {
      status: 'ready',
      command: 'node atm.mjs start --cwd . --goal "x" --json',
      recommendedChannel: 'normal',
      validators: ['a', 'b']
    }
  }
});
assert.equal((compacted as any).nextAction, undefined);
assert.equal((compacted.evidence as any).firstLayerCompactOrientation.status, 'ready');
assert.equal((compacted.evidence as any).firstLayerCompactOrientation.recommendedChannel, 'normal');
assert.equal((compacted.evidence as any).firstLayerCompactOrientation.validatorSummary.count, 2);
assert.equal((compacted.messages as any[])[0].data.steps, undefined);
assert.equal((compacted.messages as any[])[0].data.fullPlaybookPath, 'evidence.nextAction.playbook');

console.log('first-layer ux routing ok');
