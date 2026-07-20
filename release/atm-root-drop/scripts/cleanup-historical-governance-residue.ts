import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

type Disposition = "active" | "reachable" | "quarantineable" | "deletable" | "needs-owner";

type ResidueReceipt = {
  path: string;
  kind: string;
  disposition: Disposition;
  reason: string;
  digest: string;
  command: string;
  rollbackRef: string;
};

type CleanupSummary = {
  schemaId: "atm.historicalResidueCleanup.v1";
  taskId: "TASK-TMP-0002";
  mode: "dry-run" | "write-plan";
  mutationPolicy: "no-runtime-history-deletion";
  mutations: never[];
  totals: Record<Disposition | "all", number>;
  receipts: ResidueReceipt[];
  reportPath: string;
};

const ROOT = process.cwd();
const REPORT_PATH = "docs/reports/historical-governance-residue-cleanup.md";

function parseArgs(argv: string[]) {
  return {
    json: argv.includes("--json"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--write-plan"),
    writeReport: !argv.includes("--no-report"),
  };
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

function digest(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function ageHours(path: string): number {
  return (Date.now() - statSync(path).mtimeMs) / 3_600_000;
}

function classify(path: string): Pick<ResidueReceipt, "kind" | "disposition" | "reason" | "command" | "rollbackRef"> | null {
  const normalized = rel(path);
  const fresh = ageHours(path) < 24;

  if (/^\.atm\/runtime\/(locks|lane-sessions)\//.test(normalized)) {
    return {
      kind: "active-runtime-control",
      disposition: "active",
      reason: "Runtime lock and lane-session records remain governed live state and are never deleted by historical cleanup.",
      command: "node atm.mjs lock status --json",
      rollbackRef: normalized,
    };
  }

  if (/^\.atm\/history\/tasks\/.*\.json$/.test(normalized)) {
    return {
      kind: "task-ledger",
      disposition: "reachable",
      reason: "Task ledgers are reachable governance history and must move only through ATM taskflow or reconcile commands.",
      command: `node atm.mjs tasks status --task ${normalized.split("/").pop()?.replace(/\.json$/, "")} --json`,
      rollbackRef: normalized,
    };
  }

  if (/^\.atm\/history\/task-events\//.test(normalized)) {
    return {
      kind: "task-event",
      disposition: "reachable",
      reason: "Task events are append-only evidence for ledger transitions.",
      command: "node atm.mjs tasks status --json",
      rollbackRef: normalized,
    };
  }

  if (/^\.atm\/history\/evidence\/.+\.runner-sync-receipt\.json$/.test(normalized)) {
    return {
      kind: "runner-sync-receipt",
      disposition: fresh ? "reachable" : "quarantineable",
      reason: fresh
        ? "Fresh runner-sync receipt may still be consumed by closeout or release-sync validation."
        : "Historical runner-sync receipt is not live runtime state; quarantine only after owner review confirms no closeout consumer remains.",
      command: "node atm.mjs broker runner-sync status --json",
      rollbackRef: normalized,
    };
  }

  if (/^\.atm\/history\/reports\/task-import\//.test(normalized)) {
    return {
      kind: "task-import-report",
      disposition: "reachable",
      reason: "Import reports are durable provenance for planning-to-target ledger ingestion.",
      command: "node atm.mjs tasks import --help",
      rollbackRef: normalized,
    };
  }

  if (/^\.atm\/history\/evidence\/governance-telemetry\//.test(normalized)) {
    return {
      kind: "governance-telemetry",
      disposition: "quarantineable",
      reason: "Telemetry artifacts are historical evidence; move only through a governed quarantine plan, not direct deletion.",
      command: "node atm.mjs evidence status --json",
      rollbackRef: normalized,
    };
  }

  return null;
}

function collect(): ResidueReceipt[] {
  const dirtyAtmFiles = spawnSync("git", ["status", "--porcelain", "--", ".atm"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .stdout.split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter((path) => path.startsWith(".atm/"))
    .flatMap((path) => {
      const absolute = join(ROOT, path);
      if (!existsSync(absolute)) return [];
      if (statSync(absolute).isDirectory()) return walk(absolute);
      return [absolute];
    });

  const candidates = [
    ...dirtyAtmFiles,
    ...walk(join(ROOT, ".atm", "runtime", "locks")),
    ...walk(join(ROOT, ".atm", "runtime", "lane-sessions")),
  ];

  return Array.from(new Set(candidates))
    .map((path) => {
      if (!existsSync(path) || !statSync(path).isFile()) return null;
      const classification = classify(path);
      if (!classification) return null;
      return {
        path: rel(path),
        digest: digest(path),
        ...classification,
      };
    })
    .filter((receipt): receipt is ResidueReceipt => receipt !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function summarize(receipts: ResidueReceipt[], mode: CleanupSummary["mode"]): CleanupSummary {
  const totals: CleanupSummary["totals"] = {
    all: receipts.length,
    active: 0,
    reachable: 0,
    quarantineable: 0,
    deletable: 0,
    "needs-owner": 0,
  };
  for (const receipt of receipts) totals[receipt.disposition] += 1;
  return {
    schemaId: "atm.historicalResidueCleanup.v1",
    taskId: "TASK-TMP-0002",
    mode,
    mutationPolicy: "no-runtime-history-deletion",
    mutations: [],
    totals,
    receipts,
    reportPath: REPORT_PATH,
  };
}

function renderReport(summary: CleanupSummary): string {
  const lines = [
    "# Historical Governance Residue Cleanup",
    "",
    "TASK-TMP-0002 converts historical governance residue into a dry-run disposition ledger. The cleanup policy is intentionally non-destructive: no `.atm` runtime or history file is deleted by this script.",
    "",
    "## Summary",
    "",
    `- Schema: \`${summary.schemaId}\``,
    `- Mode: \`${summary.mode}\``,
    `- Mutation policy: \`${summary.mutationPolicy}\``,
    `- Planned mutations: ${summary.mutations.length}`,
    `- Receipts: ${summary.totals.all}`,
    `- Active: ${summary.totals.active}`,
    `- Reachable: ${summary.totals.reachable}`,
    `- Quarantineable: ${summary.totals.quarantineable}`,
    `- Deletable: ${summary.totals.deletable}`,
    `- Needs owner: ${summary.totals["needs-owner"]}`,
    "",
    "## Disposition Rules",
    "",
    "- `active`: live runtime control files such as locks and lane sessions; keep in place.",
    "- `reachable`: evidence, task ledgers, and task events that remain connected to ATM taskflow or closeout.",
    "- `quarantineable`: historical evidence that may be moved only after owner review confirms no active closeout consumer remains.",
    "- `deletable`: reserved for future write-mode cleanup; this dry-run emits none.",
    "- `needs-owner`: reserved for ambiguous artifacts requiring explicit owner disposition.",
    "",
    "## Receipts",
    "",
    "| Disposition | Kind | Path | Digest | Reason | Verification | Rollback |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const receipt of summary.receipts) {
    lines.push(
      `| ${receipt.disposition} | ${receipt.kind} | \`${receipt.path}\` | \`${receipt.digest}\` | ${receipt.reason} | \`${receipt.command}\` | \`${receipt.rollbackRef}\` |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

const args = parseArgs(process.argv.slice(2));
const summary = summarize(collect(), args.dryRun ? "dry-run" : "write-plan");

if (args.writeReport) {
  writeFileSync(join(ROOT, REPORT_PATH), renderReport(summary), "utf8");
}

if (args.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write(renderReport(summary));
}
