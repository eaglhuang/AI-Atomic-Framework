import assert from "node:assert/strict";

import { addTrustedGitHookRuntimePath } from "../../packages/cli/src/commands/git-governance/implementation/git-process-port.ts";

const hookRuntime = "C:\\Program Files\\Git\\usr\\bin";
const windowsEnv = addTrustedGitHookRuntimePath(
  { Path: "C:\\Windows\\System32" },
  {
    platform: "win32",
    gitExecutable: "C:\\Program Files\\Git\\cmd\\git.exe",
    pathExists: (candidate) => candidate === `${hookRuntime}\\sh.exe`
  }
);
assert.equal(windowsEnv.PATH, `${hookRuntime};C:\\Windows\\System32`, "Git hook interpreter path is prepended when Git provides sh.exe");
assert.equal(windowsEnv.Path, undefined, "Windows child environment has one canonical PATH spelling");

const duplicateSafe = addTrustedGitHookRuntimePath(windowsEnv, {
  platform: "win32",
  gitExecutable: "C:\\Program Files\\Git\\cmd\\git.exe",
  pathExists: () => true
});
assert.equal(duplicateSafe.PATH, windowsEnv.PATH, "Git hook interpreter path is not duplicated");

const nonWindowsEnv = addTrustedGitHookRuntimePath(
  { PATH: "/usr/bin" },
  { platform: "linux", gitExecutable: "/usr/bin/git", pathExists: () => true }
);
assert.equal(nonWindowsEnv.PATH, "/usr/bin", "non-Windows environments retain their original PATH");

const absentRuntime = addTrustedGitHookRuntimePath(
  { PATH: "C:\\Windows\\System32" },
  {
    platform: "win32",
    gitExecutable: "C:\\Program Files\\Git\\cmd\\git.exe",
    pathExists: () => false
  }
);
assert.equal(absentRuntime.PATH, "C:\\Windows\\System32", "unverified runtime directories are never added");

console.log("[git-hook-runtime-env] ok");
