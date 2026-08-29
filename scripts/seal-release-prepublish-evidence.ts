import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RELEASE_PREPUBLISH_PROFILE,
  buildSealedPriorEvidence,
  readReleasePrepublishProfile,
  type ReleasePrepublishProfileConfig,
} from "./lib/release-prepublish-gate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFlag = process.argv.indexOf("--output");
const outputArg = outputFlag >= 0 ? String(process.argv[outputFlag + 1] ?? "").trim() : "";
if (!outputArg || outputArg.startsWith("--")) {
  process.stderr.write("seal-release-prepublish-evidence requires --output <path>\n");
  process.exitCode = 1;
  process.exit();
}

const config = JSON.parse(
  readFileSync(path.join(root, "scripts", "validators.config.json"), "utf8"),
);
const profile = readReleasePrepublishProfile(
  config.profiles?.[RELEASE_PREPUBLISH_PROFILE] as ReleasePrepublishProfileConfig,
);
if (!profile.ok) {
  process.stderr.write(`${profile.code} ${profile.message}\n`);
  process.exitCode = 1;
  process.exit();
}

const head = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
const headCommit = String(head.stdout ?? "").trim();
if (head.status !== 0 || !headCommit) {
  process.stderr.write("unable to read git HEAD for release-prepublish evidence\n");
  process.exitCode = 1;
  process.exit();
}

const evidence = buildSealedPriorEvidence({
  headCommit,
  obligations: profile.profile.requiredObligations,
});
const resolved = path.resolve(root, outputArg);
mkdirSync(path.dirname(resolved), { recursive: true });
writeFileSync(resolved, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${path.relative(root, resolved).replace(/\\/g, "/")}\n`);
