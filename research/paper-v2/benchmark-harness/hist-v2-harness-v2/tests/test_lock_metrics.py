"""file_lock cost metrics under contention."""

import tempfile
import threading
import time
import unittest
from pathlib import Path

from hist_v2_harness_v2.locking import empty_metrics, whole_file_lock


class LockMetricTests(unittest.TestCase):
    def test_second_writer_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            lock_path = Path(temp) / "file.lock"
            first = empty_metrics()
            second = empty_metrics()
            release = threading.Event()
            entered = threading.Event()

            def hold() -> None:
                with whole_file_lock(lock_path, first):
                    entered.set()
                    release.wait(2)

            thread = threading.Thread(target=hold)
            thread.start()
            self.assertTrue(entered.wait(2))
            started = time.monotonic()

            def wait_lock() -> None:
                with whole_file_lock(lock_path, second):
                    return

            waiter = threading.Thread(target=wait_lock)
            waiter.start()
            time.sleep(0.05)
            release.set()
            waiter.join(2)
            thread.join(2)
            self.assertGreaterEqual(second["blocked_count"], 1)
            self.assertGreater(second["lock_wait_ms"], 0)
            self.assertGreater(second["serialization_delay_ms"], 0)
            self.assertGreaterEqual(time.monotonic() - started, 0)


if __name__ == "__main__":
    unittest.main()
