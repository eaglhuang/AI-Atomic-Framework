"""The hunk applier is pinned to CORE_MERGE cb25242433, not the live core."""

import hashlib
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PINNED = ROOT / "node" / "pinned" / "unified-patch.cb252424.ts"
CORE_MERGE = "cb25242433882d34b514b79338d1a00def53a875"
PINNED_SHA = "2e3eb3a000a6e6aae79e3b509ece3616af9c94aa447d6028bf4d511413c0c596"


class PinnedApplierTests(unittest.TestCase):
    def test_apply_patch_imports_the_pinned_copy(self) -> None:
        text = (ROOT / "node" / "apply-patch.ts").read_text(encoding="utf-8")
        self.assertIn("./pinned/unified-patch.cb252424.ts", text)
        self.assertNotIn("packages/core/src/broker/unified-patch.ts'", text)

    def test_pinned_copy_hash(self) -> None:
        self.assertEqual(hashlib.sha256(PINNED.read_bytes()).hexdigest(), PINNED_SHA)
        self.assertNotIn("import ", PINNED.read_text(encoding="utf-8").split("\n", 40)[0])

    def test_pinned_copy_matches_core_merge_when_history_is_present(self) -> None:
        repo = ROOT
        while repo != repo.parent and not (repo / "atm.mjs").is_file():
            repo = repo.parent
        done = subprocess.run(
            ["git", "-C", str(repo), "show", f"{CORE_MERGE}:packages/core/src/broker/unified-patch.ts"],
            capture_output=True,
            check=False,
        )
        if done.returncode != 0:
            self.skipTest("core merge not in local history (shallow clone)")
        self.assertEqual(done.stdout, PINNED.read_bytes())


if __name__ == "__main__":
    unittest.main()
