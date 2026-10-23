# New kit construction: cli-0.1.22-v14-367

Construction staging, not sealed or runnable as a complete experiment yet. This first slice fixes #398 by forwarding malformed and no-op submissions through published CLI 0.1.22 so core can retain the first original-intent anchor. No CLI re-pin is needed for that fix; the sealed replay demonstrates that core already protects it. Old kit files and manifests are unchanged. The final generation manifest will be created only after the dataset, third arm, scorer, #374 parity and preflight work pass. No model runs or formal runs in this slice.
