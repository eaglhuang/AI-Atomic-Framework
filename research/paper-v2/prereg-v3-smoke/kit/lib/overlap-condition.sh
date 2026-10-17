# 預先登記的冒煙測試不設定這個變數。兩支 session 仍各拿自己的 instance。
# 未來要強制重疊時才設 PREREG_OVERLAP_CONDITION=same-loader-region。
# 那一輪不是預先登記的條件。未設定時 results.json 的 overlapCondition 是 none。
overlap_condition_note() {
  if [ "${PREREG_OVERLAP_CONDITION:-}" != "same-loader-region" ]; then
    return 0
  fi
  cat <<'EOF'
Separate condition, not the preregistered smoke. Both sessions are assigned the same edit: django/db/migrations/loader.py lines 88-102. Put the required change in that region of that file.
EOF
}
