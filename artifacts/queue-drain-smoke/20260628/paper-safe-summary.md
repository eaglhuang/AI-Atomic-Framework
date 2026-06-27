# Queue Drain Smoke

- Safe claim: finite contention smoke confirms preserved intents are not lost for N=5/10/20/50 under the shared-surface queue model.
- Non-claim: this is not a liveness proof.

- N=5: preserved=5, lost=0, drains=true
- N=10: preserved=10, lost=0, drains=true
- N=20: preserved=20, lost=0, drains=true
- N=50: preserved=50, lost=0, drains=true
