# hist-v2-dev-replay/2

pilot 用的 29 題 dev 綁定。不是論文結果。v1（`hist-v2-dev-replay/1`）保持封存。

```bash
python3 -m unittest discover -s research/paper-v2/benchmark-main/2026-10-15-hist-v2-dev-replay-v2/tests -v
sh research/paper-v2/benchmark-main/2026-10-15-hist-v2-dev-replay-v2/verify.sh
```

`build_bindings.py` 在 `bindings/` 已有 json 時拒絕覆寫（退出碼 6）。
