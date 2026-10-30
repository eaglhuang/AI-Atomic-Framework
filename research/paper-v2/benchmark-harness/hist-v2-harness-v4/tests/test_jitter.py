"""Prereg §9 uniform jitter. Seed-determined, and zero when the interval is zero."""

import unittest

from hist_v2_harness_v4.materialize import arrival_delay_ms, jitter_cap_ms, jitter_ms


class JitterTests(unittest.TestCase):
    def test_cap_is_min_of_10ms_and_ten_percent(self) -> None:
        self.assertEqual(jitter_cap_ms(0), 0)
        self.assertEqual(jitter_cap_ms(50), 5)
        self.assertEqual(jitter_cap_ms(100), 10)
        self.assertEqual(jitter_cap_ms(500), 10)
        self.assertEqual(jitter_cap_ms(2000), 10)

    def test_interval_zero_has_no_jitter_and_no_delay(self) -> None:
        for index in (0, 1):
            self.assertEqual(jitter_ms(0, "item", "forward", 0, index), 0)
            self.assertEqual(arrival_delay_ms(1, "item", "reverse", 0, index), 0)

    def test_same_seed_repeats_and_stays_inside_the_cap(self) -> None:
        first = jitter_ms(7, "django:dev:1", "forward", 500, 1)
        second = jitter_ms(7, "django:dev:1", "forward", 500, 1)
        other = jitter_ms(8, "django:dev:1", "forward", 500, 1)
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)
        self.assertGreaterEqual(first, 0)
        self.assertLessEqual(first, 10)
        delay = arrival_delay_ms(7, "django:dev:1", "forward", 500, 1)
        self.assertEqual(delay, 500 + first)

    def test_writer_index_zero_is_only_jitter(self) -> None:
        jitter = jitter_ms(3, "item", "reverse", 50, 0)
        self.assertEqual(arrival_delay_ms(3, "item", "reverse", 50, 0), jitter)
        self.assertLessEqual(jitter, 5)


if __name__ == "__main__":
    unittest.main()
