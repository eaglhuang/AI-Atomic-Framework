import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBootstrap } from '../../packages/cli/src/commands/bootstrap-entry.ts';
import { runWelcome } from '../../packages/cli/src/commands/welcome.ts';

const chartRelative = '.atm/memory/atm-chart.md';

// Fresh onefile-style target: bootstrap, then welcome with no manual chart step.
{
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-bootstrap-chart-'));
  try {
    const bootstrap = await runBootstrap(['--cwd', cwd, '--json']);
    assert.equal(bootstrap.ok, true);
    assert.ok(existsSync(path.join(cwd, chartRelative)), 'bootstrap renders the ATMChart');
    assert.equal((bootstrap.evidence as Record<string, any>).atmChart?.status, 'rendered');
    assert.ok(bootstrap.messages.some((entry) => entry.code === 'ATM_BOOTSTRAP_CHART_RENDERED'));

    const welcome = await runWelcome(['--cwd', cwd, '--json']);
    const codes = [...(welcome.messages ?? [])].map((entry) => entry.code);
    assert.equal(codes.includes('ATM_CHART_MISSING'), false, 'welcome no longer reports a missing chart after bootstrap');
    assert.equal(welcome.ok, true, `welcome succeeds right after bootstrap: ${codes.join(',')}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// An existing chart is not overwritten by a repeated bootstrap.
{
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-bootstrap-chart-'));
  try {
    await runBootstrap(['--cwd', cwd, '--json']);
    const chartPath = path.join(cwd, chartRelative);
    writeFileSync(chartPath, `${readFileSync(chartPath, 'utf8')}\n<!-- local note -->\n`);
    const before = readFileSync(chartPath);
    const again = await runBootstrap(['--cwd', cwd, '--json']);
    assert.equal((again.evidence as Record<string, any>).atmChart?.status, 'existing');
    assert.deepEqual(readFileSync(chartPath), before);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// Dry-run does not render anything.
{
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-bootstrap-chart-'));
  try {
    await runBootstrap(['--cwd', cwd, '--dry-run', '--json']);
    assert.equal(existsSync(path.join(cwd, chartRelative)), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

console.log('ok: bootstrap renders the ATMChart so welcome works immediately');
