"""The sealed directory checksum is read-only."""

import subprocess
import unittest
from pathlib import Path


class VerifyTests(unittest.TestCase):
    def test_verify_sh_does_not_rewrite_checksums(self) -> None:
        root = Path(__file__).resolve().parents[1]
        before = (root / "SHA256SUMS").read_bytes()
        done = subprocess.run(["sh", str(root / "verify.sh"), str(root)], capture_output=True, text=True, check=False)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("OK:", done.stdout)
        self.assertEqual((root / "SHA256SUMS").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
