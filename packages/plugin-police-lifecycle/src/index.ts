import type {
  LifecyclePoliceFinding,
  LifecyclePoliceNotice,
  LifecyclePoliceReport,
  LifecyclePoliceRoute,
  LifecyclePoliceSeverity,
  LifecyclePoliceTrigger,
} from '../../plugin-sdk/src/police.ts';

export const LIFECYCLE_POLICE_WRITER = 'lifecycle-police';

function createFinding(params: {
  atomId: string;
  trigger: LifecyclePoliceTrigger;
  severity: LifecyclePoliceSeverity;
  action: LifecyclePoliceFinding['action'];
  route: LifecyclePoliceRoute;
  message: string;
  scope: string;
  callerIds?: readonly string[];
}): LifecyclePoliceFinding {
  return {
    findingId: `lifecycle.${params.trigger}.${params.atomId}`,
    atomId: params.atomId,
    trigger: params.trigger,
    scope: params.scope,
    severity: params.severity,
    action: params.action,
    route: params.route,
    message: params.message,
    callerIds: params.callerIds,
  };
}

export function canWriteQuarantine(actor: string): boolean {
  return String(actor || '').trim() === LIFECYCLE_POLICE_WRITER;
}

export function buildCallerMigrationNotices(findings: readonly LifecyclePoliceFinding[]): readonly LifecyclePoliceNotice[] {
  const notices: LifecyclePoliceNotice[] = [];
  for (const finding of findings) {
    if (finding.action !== 'notify-migration') {
      continue;
    }
    notices.push({
      noticeId: `notice.${finding.atomId}.migration`,
      atomId: finding.atomId,
      callerIds: finding.callerIds ?? [],
      recommendedAction: 'migrate-callers-before-sweep',
      reason: finding.message,
    });
  }
  return notices;
}

export interface LifecyclePoliceInputEntry {
  readonly atomId: string;
  readonly status: string;
  readonly ttlExpired?: boolean;
  readonly callerCount?: number;
  readonly callerIds?: readonly string[];
  readonly deployScope?: 'dev-only' | 'all';
}

export interface LifecyclePoliceTransitionCheck {
  readonly atomId: string;
  readonly ok: boolean;
  readonly reason?: string;
}

export interface LifecyclePoliceRunOptions {
  readonly entries: readonly LifecyclePoliceInputEntry[];
  readonly transitions?: readonly LifecyclePoliceTransitionCheck[];
  readonly buildTarget?: 'production' | 'development';
  readonly actor?: string;
}

export function runLifecyclePolice(options: LifecyclePoliceRunOptions): LifecyclePoliceReport {
  const findings: LifecyclePoliceFinding[] = [];

  for (const entry of options.entries) {
    if (entry.status === 'deprecated' && entry.ttlExpired === true) {
      findings.push(createFinding({
        atomId: entry.atomId,
        trigger: 'ttl-expired',
        severity: 'warning',
        action: 'expire',
        route: 'needs-review',
        scope: 'entry',
        message: `TTL expired for ${entry.atomId}; recommend expire.`
      }));
    }

    const callerCount = typeof entry.callerCount === 'number' ? entry.callerCount : 0;
    if (entry.status === 'active' && callerCount === 0) {
      findings.push(createFinding({
        atomId: entry.atomId,
        trigger: 'zero-caller',
        severity: 'warning',
        action: 'sweep',
        route: 'needs-review',
        scope: 'entry',
        message: `No active callers for ${entry.atomId}; recommend sweep.`
      }));
    }
    if (entry.status === 'active' && callerCount > 0 && entry.ttlExpired === true) {
      findings.push(createFinding({
        atomId: entry.atomId,
        trigger: 'caller-migration',
        severity: 'info',
        action: 'notify-migration',
        route: 'follow-up-task',
        scope: 'dependency-graph',
        message: `TTL expired but ${callerCount} callers still reference ${entry.atomId}; migrate callers first.`,
        callerIds: entry.callerIds ?? [],
      }));
    }

    if (options.buildTarget === 'production' && entry.deployScope === 'dev-only') {
      findings.push(createFinding({
        atomId: entry.atomId,
        trigger: 'deploy-scope-violation',
        severity: 'error',
        action: 'hard-fail',
        route: 'quarantine',
        scope: 'build',
        message: `dev-only atom ${entry.atomId} detected in production build.`
      }));
    }
  }

  for (const transition of options.transitions ?? []) {
    if (transition.ok) {
      continue;
    }
    findings.push(createFinding({
      atomId: transition.atomId,
      trigger: 'illegal-transition',
      severity: 'error',
      action: 'quarantine',
      route: 'quarantine',
      scope: 'status-machine',
      message: transition.reason || `Illegal transition detected for ${transition.atomId}.`
    }));
  }

  const notices = buildCallerMigrationNotices(findings);
  const canWrite = canWriteQuarantine(options.actor ?? LIFECYCLE_POLICE_WRITER);

  return {
    schemaId: 'atm.lifecyclePoliceReport',
    specVersion: '0.1.0',
    findings,
    notices,
    quarantineWriteGuard: {
      writer: LIFECYCLE_POLICE_WRITER,
      allowed: canWrite,
    },
    hardFail: findings.some((finding) => finding.action === 'hard-fail' || finding.action === 'quarantine'),
  };
}

export const lifecyclePolicePlugin = {
  pluginId: 'lifecycle-police-plugin',
  run: runLifecyclePolice,
};

export default lifecyclePolicePlugin;
