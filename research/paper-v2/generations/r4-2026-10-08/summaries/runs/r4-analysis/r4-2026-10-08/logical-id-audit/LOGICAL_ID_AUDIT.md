# E1/E2 logical_id stub audit（r2）

{"cells": 200, "cells_ok": 200, "cells_with_stub": 200, "cells_with_multi_attempt_ops": 29, "multi_attempt_ops": 129, "extra_attempts": 132, "verdict": "salvageable: each intent = one logical op (1 submit, 1 terminal, <=1 correct effect); offered denominator fixed"}

條件：每個預登記 intent 恰 1 個 submit、1 個 terminal decision、correct≤1；offered＝唯一 intent 數。多 attempt（OCC／git 的 CAS retry，記在 repropose_rounds 欄）另列，不算違規。
不證明 exactly-once；只證明在 E1/E2 中 intent 與 logical operation 一對一、分母固定，故舊分母可沿用。steward 臂 re-propose 仍是 stub（未實作），不在此證明範圍。
