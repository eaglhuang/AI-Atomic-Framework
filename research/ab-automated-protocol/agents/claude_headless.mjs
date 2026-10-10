#!/usr/bin/env node
// Real-agent adapter: runs Claude Code headless in the writer's worktree and records API usage.
// Usage: node claude_headless.mjs <promptFile> <usageFile>   (cwd = writer worktree)
// Env: AB_MODEL (required; the model is chosen at run time and recorded in each run's usage file),
//      AB_PROMPT_PREFIX (arm-specific text placed before the task).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const [promptFile, usageFile] = process.argv.slice(2);
const model = process.env.AB_MODEL;
if (!model) {
  console.error('AB_MODEL is required');
  process.exit(2);
}
const task = JSON.parse(fs.readFileSync(promptFile, 'utf8')).text;
const prefix = process.env.AB_PROMPT_PREFIX ? process.env.AB_PROMPT_PREFIX + '\n\n' : '';

const r = spawnSync('claude', [
  '-p', prefix + task,
  '--model', model,
  '--output-format', 'json',
  '--permission-mode', 'acceptEdits',
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let out = null;
try { out = JSON.parse(r.stdout); } catch { out = null; }
const u = out?.usage || {};
// Input side includes cache reads/writes so tokens are comparable across arms that cache differently.
const usage = {
  model,
  inputTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
  outputTokens: u.output_tokens || 0,
  costUsd: typeof out?.total_cost_usd === 'number' ? out.total_cost_usd : null,
  source: 'claude-cli-json',
  isError: out ? Boolean(out.is_error) : true,
};
fs.writeFileSync(usageFile, JSON.stringify(usage));
process.exit(r.status ?? 1);
