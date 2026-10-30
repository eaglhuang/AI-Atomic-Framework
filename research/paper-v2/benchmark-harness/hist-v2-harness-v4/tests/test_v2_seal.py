"""Harness v2 bytes stay the sealed generation."""

import subprocess
import unittest
from pathlib import Path


class V2SealTests(unittest.TestCase):
    def test_v2_verify_still_passes(self) -> None:
        root = Path(__file__).resolve().parents[2] / "hist-v2-harness-v2"
        done = subprocess.run(["sh", str(root / "verify.sh"), str(root)], capture_output=True, text=True, check=False)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("OK:", done.stdout)


if __name__ == "__main__":
    unittest.main()
