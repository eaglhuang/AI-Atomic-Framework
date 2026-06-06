#!/usr/bin/env node
/**
 * atomization-coverage-guard.js
 * 對應: TASK-ASA-0004
 *
 * 驗證 atomization coverage 是否符合 thresholds
 * 使用: node atm.mjs guard validate atomization-coverage --repo . --json
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export async function validateAtomizationCoverage(options) {
  const repoPath = options.repo || '.';
  const fullPath = resolve(repoPath);

  const thresholds = {
    source_ownership_coverage: 30,    // 至少 30% source paths 需有 owner
    public_command_coverage: 50,      // 至少 50% CLI 命令需有 atom
    runtime_behavior_coverage: 40,    // 至少 40% runtime behaviors
    evidence_coverage: 60,             // 至少 60% atoms 需有 evidence
    integration_health: 80,            // 至少 80% adapters
  };

  const violations = [];
  let passedChecks = 0;
  const totalChecks = Object.keys(thresholds).length;

  // 讀取最近的 dogfood score
  const scoreReportPath = resolve(fullPath, 'atomic_workbench', 'atomization-coverage', 'last-score.json');
  let currentScores = {};

  if (existsSync(scoreReportPath)) {
    try {
      const data = JSON.parse(readFileSync(scoreReportPath, 'utf-8'));
      currentScores = data.components || {};
    } catch (e) {
      // 無法讀取報告
    }
  }

  // 如果沒有報告，使用預設估計值
  if (!currentScores.source_ownership_coverage) {
    currentScores = {
      source_ownership_coverage: 3,
      public_command_coverage: 16,
      runtime_behavior_coverage: 0,
      evidence_coverage: 0,
      integration_health: 50
    };
  }

  // 檢查每個 threshold
  for (const [metric, threshold] of Object.entries(thresholds)) {
    const current = currentScores[metric] || 0;
    const isPassing = current >= threshold;

    if (!isPassing) {
      violations.push({
        metric,
        current,
        threshold,
        gap: threshold - current,
        severity: current === 0 ? 'critical' : (threshold - current > 30 ? 'high' : 'medium')
      });
    } else {
      passedChecks++;
    }
  }

  const overallPassing = violations.length === 0;
  const coveragePercentage = Math.round((passedChecks / totalChecks) * 100);

  return {
    status: overallPassing ? 'pass' : 'fail',
    coverage: {
      passed: passedChecks,
      total: totalChecks,
      percentage: coveragePercentage
    },
    violations,
    thresholds,
    current_scores: currentScores,
    remediation_plan: violations.length > 0 ? generateRemediationPlan(violations) : null,
    timestamp: new Date().toISOString()
  };
}

function generateRemediationPlan(violations) {
  const critical = violations.filter(v => v.severity === 'critical');
  const high = violations.filter(v => v.severity === 'high');

  const plan = {
    immediate_actions: critical.map(v => ({
      metric: v.metric,
      action: `Increase ${v.metric} from ${v.current}% to at least ${v.threshold}%`,
      priority: 'P0'
    })),
    followup_actions: high.map(v => ({
      metric: v.metric,
      action: `Increase ${v.metric} by ${v.gap} percentage points`,
      priority: 'P1'
    }))
  };

  return plan;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await validateAtomizationCoverage({ repo: '.' });
  console.log(JSON.stringify(result, null, 2));
}
