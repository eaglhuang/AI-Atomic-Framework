#!/usr/bin/env bash
set -euo pipefail
# Existing public starter + governed task lifecycle, shared by candidate release gate.
release_version="${1:?exact release version required}"
NPM_DIST_TAG="${2:?target channel required}"
manifest_path="${3:?sealed artifact manifest required}"
export npm_config_registry=https://registry.npmjs.org
# Disposable smoke identity is provided before the starter creates its initial commit.
export GIT_AUTHOR_NAME="Release Starter" GIT_AUTHOR_EMAIL=release-starter@example.invalid
export GIT_COMMITTER_NAME="Release Starter" GIT_COMMITTER_EMAIL=release-starter@example.invalid
starter_root=$(mktemp -d)
trap 'rm -rf "$starter_root"' EXIT
# Run outside the repository: inside the workspace root npm resolves the
# local create-atm workspace and never links the published bin.
cd "$starter_root"
npm exec --yes --package "create-atm@$release_version" -- create-atm project --agent codex --tag "$NPM_DIST_TAG" --cli-version "$release_version" --cwd "$starter_root" --json > "$starter_root/result.json"
jq -e --arg version "$release_version" '.ok == true and .evidence.atmEntrypointSource == "target-dependency" and .evidence.runtimeVersion == $version' "$starter_root/result.json"
# Verify the runtime actually installed by the starter against the sealed pair.
(cd "$starter_root/project" && node atm.mjs --version --json) > "$starter_root/identity.json"
jq -e --slurpfile manifest "$manifest_path" '
  .evidence.runtimeBuildIdentity as $runtime |
  $manifest[0] as $release |
  ($release.artifacts[] | select(.name == "@ai-atomic-framework/cli")) as $cli |
  $runtime.status == "verified" and $runtime.executionMode == "npm-package" and
  $runtime.version == $release.version and $runtime.sourceCommit == $release.sourceCommit and
  $runtime.sourceDigest == $release.sourceDigest and $runtime.buildId == $cli.buildId
' "$starter_root/identity.json"
jq -e --slurpfile manifest "$manifest_path" '
  .packages["node_modules/@ai-atomic-framework/cli"] as $runtime |
  ($manifest[0].artifacts[] | select(.name == "@ai-atomic-framework/cli")) as $cli |
  $runtime.version == $cli.version and $runtime.integrity == $cli.integrity
' "$starter_root/project/package-lock.json"
test -s "$starter_root/project/.agents/skills/atm-governance-router/SKILL.md"
test -s "$starter_root/project/.agents/skills/atm-governance-router/references/index.md"
(cd "$starter_root/project" && node atm.mjs next --json)

# The published starter must carry an AI through its own local task
# card end to end, every command in a fresh process and the claim
# lane passed only as the playbook's --lane-session.
cd "$starter_root/project"
git rev-parse --verify HEAD > /dev/null
test "$(git rev-list --count HEAD)" = 1
node atm.mjs taskflow open --write --actor starter --title "Add greeting" --goal "Print a greeting." --scope-path src/greet.mjs,scripts/check-greet.mjs --validator "node scripts/check-greet.mjs" --json > "$starter_root/open.json"
task_id=$(ls docs/tasks/*.task.md | head -n 1 | xargs -n1 basename | sed 's/\.task\.md$//')
node atm.mjs identity set --actor starter --git-name "Release Starter" --git-email release-starter@example.invalid --json > /dev/null
node atm.mjs next --claim --actor starter --task "$task_id" --auto-intent --json > "$starter_root/claim.json"
lane=$(jq -r '.evidence.nextAction.playbook.closePreview.writeCommand' "$starter_root/claim.json" | grep -o -- '--lane-session [^ ]*' | cut -d' ' -f2)
test -n "$lane"
mkdir -p src scripts
printf "export const greeting = 'hello';\n" > src/greet.mjs
printf "import { greeting } from '../src/greet.mjs';\nif (greeting !== 'hello') process.exit(1);\nconsole.log('greet: 1 case passed');\n" > scripts/check-greet.mjs
node atm.mjs git commit --actor starter --task "$task_id" --message "feat: greeting" --auto-stage --lane-session "$lane" --json > /dev/null
node atm.mjs evidence run --task "$task_id" --actor starter --command "node scripts/check-greet.mjs" --validators "node scripts/check-greet.mjs" --lane-session "$lane" --json > /dev/null
delivery=$(git rev-parse HEAD)
node atm.mjs taskflow close --task "$task_id" --actor starter --historical-delivery "$delivery" --write --lane-session "$lane" --json > "$starter_root/close.json"
jq -e '.ok == true' "$starter_root/close.json"
grep -q '^status: done$' "docs/tasks/$task_id.task.md"
