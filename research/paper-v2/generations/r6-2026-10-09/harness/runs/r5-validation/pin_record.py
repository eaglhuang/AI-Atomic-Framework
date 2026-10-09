#!/usr/bin/env python3
"""r5: record the four ATM pins (read-only). Output: PINS.json + PINS.md in argv[1] (default runs/r3-validation)."""
import hashlib, json, os, subprocess, sys, tarfile
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
PINS = {
  '37847584': dict(role='r5 pin (PR #216 merge; parents 44a9ee19, 5e39ee12; kernel advisory commit lock via node:sqlite, orphan-temp cleanup under the lock, per-target broker apply queue)', dir='/workspace/atm-main-37847584', sha='37847584e24afc08ea58cfe380bb5b1220fbe335'),
  '2118bc66': dict(role='r4 pin (PR #214 merge; feature commit b5729456bc14d9bf4c8acfce7be320fec691fee2; steward completion-rate optimizations)', dir='/workspace/atm-main-2118bc66', sha='2118bc66efb3ac3bc0ddaede6a2f7cb18526b030'),
  '5692474f': dict(role='baseline (r1/r2 pin; PR #198 merge)', dir='/workspace/atm-main-5692474f', sha='5692474f7db70ab52a7a71c8af4867609e7e4b43'),
  'bea35380': dict(role='r3 pin (PR #213 merge; feature commit 4d7c9ed6287173f6f704e8d0a0d8a99683776bff; base main 53e6fdb0fca462212c7d1a26dcdfa74653cf4436)',
                   dir='/workspace/atm-main-bea35380', sha='bea35380d7f381f998c9930fa95f01b999c7f208'),
}
H = lambda b: hashlib.sha256(b).hexdigest()
def fh(p): return H(open(p, 'rb').read())
def tree_hash(root, sub):
  lines = []
  for d, ds, fs in os.walk(os.path.join(root, sub)):
    ds.sort(); ds[:] = [x for x in ds if x != 'node_modules']
    for f in sorted(fs):
      p = os.path.join(d, f); lines.append(f"{fh(p)}  {os.path.relpath(p, root)}")
  return H('\n'.join(sorted(lines, key=lambda l: l[66:])).encode()), len(lines)
res = {}
for k, v in PINS.items():
  root = os.path.join(v['dir'], f"AI-Atomic-Framework-{v['sha']}"); tgz = os.path.join(v['dir'], 'atm-main.tar.gz')
  with tarfile.open(tgz) as t: tar_commit = t.pax_headers.get('comment')
  core_hash, core_n = tree_hash(root, 'packages/core/src')
  broker = os.path.join(root, 'packages/core/src/broker')
  keyfiles = {f: fh(os.path.join(broker, f)) for f in sorted(os.listdir(broker))
              if f.startswith('steward') or f in ('compose.ts', 'decision.ts', 'registry.ts', 'registry-store.ts', 'merge-plan.ts', 'unified-patch.ts')}
  deps = {}
  for n in sorted(os.listdir(os.path.join(root, 'node_modules'))):
    p = os.path.join(root, 'node_modules', n); real = os.path.realpath(p)
    pj = json.load(open(os.path.join(real, 'package.json')))
    deps[n] = dict(symlink_target=os.readlink(p) if os.path.islink(p) else None, version=pj.get('version'), package_json_sha256=fh(os.path.join(real, 'package.json')))
  res[k] = dict(role=v['role'], resolved_commit=v['sha'], tarball_url=f"https://codeload.github.com/eaglhuang/AI-Atomic-Framework/tar.gz/{v['sha']}",
    tarball_path=tgz, tarball_bytes=os.path.getsize(tgz), tarball_sha256=fh(tgz), tarball_embedded_commit=tar_commit,
    tarball_commit_matches=(tar_commit == v['sha']), tree=root, core_package_version=json.load(open(os.path.join(root, 'packages/core/package.json')))['version'],
    packages_core_src_tree_sha256=core_hash, packages_core_src_files=core_n, broker_key_files_sha256=keyfiles, node_modules=deps,
    install_mechanism='GitHub commit tarball (codeload) extracted on the box; node_modules = the same 5 symlinks as the 5692474f pin (ajv runtime deps only); selected per run via ATM_MONOREPO; no npm publish / tag / clone')
def bdiff(a, b): return {f: ('added' if f not in a['broker_key_files_sha256'] else 'changed') for f in b['broker_key_files_sha256'] if a['broker_key_files_sha256'].get(f) != b['broker_key_files_sha256'][f]}
res['diff_core_broker_5692474f_to_bea35380'] = bdiff(res['5692474f'], res['bea35380'])
res['diff_core_broker_bea35380_to_2118bc66'] = bdiff(res['bea35380'], res['2118bc66'])
res['diff_core_broker_2118bc66_to_37847584'] = bdiff(res['2118bc66'], res['37847584'])
res['note'] = ('core/package.json version label is identical (0.1.2) at both pins; identify runs by meta atm_version source path (contains full SHA). '
               'Other differences between the pins are outside packages/core (cli, tests, docs, scripts) and are not loaded by the harness.')
json.dump(res, open(os.path.join(OUT, 'PINS.json'), 'w'), indent=1)
print(json.dumps({k: (v['tarball_sha256'], v['tarball_commit_matches'], v['packages_core_src_tree_sha256']) for k, v in res.items() if k in PINS}, indent=0)); print(res['diff_core_broker_2118bc66_to_37847584'])
