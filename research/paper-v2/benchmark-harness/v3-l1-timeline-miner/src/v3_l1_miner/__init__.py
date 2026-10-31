"""Prereg v3 L1 historical PR timeline miner (W1).

Fetches, per pull request, the commit list with author/committer dates and the
files each commit touched, then derives the L1 quantities of prereg v3 draft
section 6.2: t_start, t_write(f), t_submit, S1/S2/S3 claim sets and the
cumulative line timeline. Zero model calls; GitHub REST only.
"""

SCHEMA_ID = "atm.paper-v3.l1-timeline.v1"
MINER_VERSION = "1"
