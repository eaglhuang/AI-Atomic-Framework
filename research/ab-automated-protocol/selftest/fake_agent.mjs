// Deterministic stand-in for a real coding agent, used only to exercise the runner.
// Usage: node fake_agent.mjs <promptFile> <usageFile>   (run with cwd = agent worktree)
import fs from 'node:fs';
const [promptFile, usageFile] = process.argv.slice(2);
const prompt = JSON.parse(fs.readFileSync(promptFile, 'utf8'));
for (const e of prompt.edits) {
  fs.appendFileSync(e.file, e.append);
}
fs.writeFileSync(usageFile, JSON.stringify({ inputTokens: 1200, outputTokens: 300, costUsd: 0.0123, source: 'fake-agent' }));
