#!/bin/bash
# Linux 沒有免密碼 sudo 時，Arm B 的強制邊界。
# 只供 common.sh source。不要直接執行。
#
# 優先使用 Codex CLI 自己的 sandbox（不呼叫模型）：
#   codex sandbox -P prereg-session -C <scratch> -- <cmd>
# profile 繼承 :workspace，並打開 network，讓 Unix socket 連得到。
# scratch 是唯一的工作目錄可寫根；儲存庫不是可寫根，也不能放在 /tmp 或 scratch 裡面。
# steward 行程在沙盒外面，以一般使用者執行。socket 放在 scratch。
#
# 若 codex sandbox 起不來，改用 bubblewrap，同樣不給 session 重新掛載的能力：
#   bwrap --unshare-user --unshare-pid --die-with-parent \
#     --ro-bind / / --bind <scratch> <scratch> \
#     --bind <extra> <extra> --ro-bind <repo> <repo> \
#     --dev /dev --proc /proc --cap-drop ALL -- <cmd>
# 單獨的 unshare 把掛載改成唯讀之後，使用者命名空間裡的 root 可以 remount,rw，不能當邊界。

sandbox_boundary_active() {
  case "${PREREG_BOUNDARY:-}" in
    codex-landlock|bwrap-ro) return 0 ;;
    *) return 1 ;;
  esac
}

boundary_mechanism_line() {
  case "${PREREG_BOUNDARY:-}" in
    unix-user)
      printf '%s\n' "mechanism=unix-user ${STEWARD_USER} owns the worktree; ${SESSION_USER} is not the owner and has no sudo"
      ;;
    codex-landlock)
      printf '%s\n' "mechanism=codex sandbox -P prereg-session -C <scratch> -- <cmd> (config profile extends :workspace, network enabled, no model call; repo is not a writable root; steward runs outside; socket is inside scratch)"
      ;;
    bwrap-ro)
      printf '%s\n' "mechanism=bwrap --unshare-user --unshare-pid --die-with-parent --ro-bind / / --bind <scratch> <scratch> --ro-bind <repo> <repo> --dev /dev --proc /proc --cap-drop ALL -- <cmd>"
      ;;
    codex-sandbox)
      printf '%s\n' "mechanism=codex exec --sandbox read-only (non-Linux; steward outside)"
      ;;
    *)
      printf '%s\n' "mechanism=unset"
      ;;
  esac
}

toml_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

write_codex_sandbox_profile() {
  local dest="$1"
  shift
  mkdir -p "$(dirname "$dest")"
  {
    echo '[permissions.prereg-session]'
    echo 'extends = ":workspace"'
    echo
    if [ "$#" -gt 0 ]; then
      echo '[permissions.prereg-session.filesystem]'
      local dir
      for dir in "$@"; do
        [ -n "$dir" ] || continue
        printf '%s = "write"\n' "$(toml_quote "$dir")"
      done
      echo
    fi
    echo '[permissions.prereg-session.network]'
    echo 'enabled = true'
  } > "$dest"
}

# Unix socket 路徑含結尾 NUL 不能超過 108。工作樹放在 state 目錄時，socket 不能跟過去。
allocate_sandbox_scratch() {
  local scratch sample
  scratch="$(mktemp -d /tmp/prereg-sbx.XXXXXX)"
  sample="${scratch}/s.sock"
  if [ "${#sample}" -gt 100 ]; then
    rm -rf "$scratch"
    die "scratch 路徑太長，Unix socket 放不進去：${scratch}"
  fi
  PREREG_SANDBOX_SCRATCH="$scratch"
  export PREREG_SANDBOX_SCRATCH
  printf '%s\n' "$scratch"
}

release_sandbox_scratch() {
  local scratch="${1:-${PREREG_SANDBOX_SCRATCH:-}}"
  case "$scratch" in
    /tmp/prereg-sbx.*)
      rm -rf "$scratch"
      ;;
  esac
}

assert_sandbox_layout() {
  local scratch="${PREREG_SANDBOX_SCRATCH:-}"
  local repo="${PREREG_SANDBOX_REPO:-}"
  [ -n "$scratch" ] && [ -d "$scratch" ] || die "沙盒邊界缺少可寫的 scratch 目錄。"
  [ -n "$repo" ] && [ -d "$repo" ] || die "沙盒邊界缺少儲存庫目錄。"
  case "$repo" in
    /tmp|/tmp/*)
      die "工作樹不能放在 /tmp。Codex :workspace 會把 /tmp 當成可寫根。"
      ;;
    "$scratch"|"$scratch"/*)
      die "工作樹不能放在 scratch 裡面，否則可寫根會蓋到儲存庫。"
      ;;
  esac
  local extra
  if [ "${PREREG_SANDBOX_EXTRA_WRITES+x}" = x ]; then
    for extra in "${PREREG_SANDBOX_EXTRA_WRITES[@]}"; do
      [ -n "$extra" ] || continue
      case "$repo" in
        "$extra"|"$extra"/*)
          die "額外可寫目錄 ${extra} 包含工作樹，沙盒邊界無效。"
          ;;
      esac
      case "$extra" in
        "$scratch"|"$scratch"/*) ;;
        *)
          [ -d "$extra" ] || die "額外可寫目錄不存在：${extra}"
          ;;
      esac
    done
  fi
}

codex_sandbox_ready() {
  command -v codex >/dev/null 2>&1 || return 1
  local scratch home err status
  scratch="$(mktemp -d)"
  home="$(mktemp -d)"
  err="$(mktemp)"
  write_codex_sandbox_profile "$home/config.toml"
  status=0
  CODEX_HOME="$home" codex sandbox -P prereg-session -C "$scratch" -- true >"$scratch/out" 2>"$err" || status=$?
  if grep -q 'bubblewrap is unavailable' "$err"; then
    status=1
  fi
  rm -rf "$scratch" "$home"
  rm -f "$err"
  return "$status"
}

bwrap_ready() {
  command -v bwrap >/dev/null 2>&1 || return 1
  bwrap --unshare-user --unshare-pid --die-with-parent \
    --ro-bind / / \
    --dev /dev --proc /proc \
    --cap-drop ALL \
    -- true >/dev/null 2>&1
}

# 選到機制時設定 PREREG_BOUNDARY 並回 0。兩個都不可用時回 1，不改成未強制模式。
resolve_linux_sandbox_mechanism() {
  [ "$(uname -s)" = "Linux" ] || return 1
  if codex_sandbox_ready; then
    PREREG_BOUNDARY=codex-landlock
    export PREREG_BOUNDARY
    return 0
  fi
  if bwrap_ready; then
    PREREG_BOUNDARY=bwrap-ro
    export PREREG_BOUNDARY
    return 0
  fi
  return 1
}

# Codex 0.159.2 的 app-server socket 固定在 /tmp/codex-daemon-<uid>，而且必須是
# 目前使用者擁有、mode 0700 的目錄。它不看 XDG_RUNTIME_DIR、TMPDIR 或 CODEX_HOME。
# bwrap --ro-bind / / 會讓這個目錄變成唯讀；既有目錄若不是 0700，內層 sandbox helper
# 會以「app-server socket directory must be a user-owned directory with mode 0700」失敗。
codex_daemon_socket_dir() {
  local tmp uid
  tmp="$(readlink -f /tmp)"
  uid="$(id -u)"
  printf '%s/codex-daemon-%s\n' "$tmp" "$uid"
}

ensure_codex_daemon_socket_mountpoint() {
  local dest="$1"
  if [ -L "$dest" ]; then
    rm -f "$dest" || die "Codex app-server socket 目錄是符號連結，無法改成 mode 0700：$dest"
  fi
  if [ ! -e "$dest" ]; then
    mkdir -m 700 "$dest" || die "無法建立 Codex app-server socket 目錄 $dest。"
  fi
  if [ ! -d "$dest" ]; then
    die "Codex app-server socket 路徑不是目錄：$dest"
  fi
  if [ "$(stat -c %u "$dest")" = "$(id -u)" ] && [ "$(stat -c %a "$dest")" != "700" ]; then
    chmod 700 "$dest" || die "無法把 $dest 設成 mode 0700。"
  fi
}

# 在 scratch 放一個 mode 0700 的目錄，bwrap 把它掛到 Codex 固定的 socket 路徑上。
# 主機上既有目錄的 mode 或擁有者不對時，沙盒裡看到的仍是這份可寫的 0700 目錄。
ensure_codex_daemon_bind() {
  local dest
  dest="$(codex_daemon_socket_dir)"
  ensure_codex_daemon_socket_mountpoint "$dest"
  local parent="${PREREG_SANDBOX_SCRATCH:-}"
  [ -n "$parent" ] && [ -d "$parent" ] || die "bwrap 需要 scratch 才能放置可寫的 Codex socket 目錄。"
  local bind="$parent/daemon-bind"
  if [ ! -d "$bind" ]; then
    mkdir -m 700 "$bind"
  fi
  chmod 700 "$bind"
  PREREG_CODEX_DAEMON_BIND="$bind"
  PREREG_CODEX_DAEMON_MOUNT="$dest"
  export PREREG_CODEX_DAEMON_BIND PREREG_CODEX_DAEMON_MOUNT
}

# bwrap 參數與 boundary_launch_args 共用，避免探測用的指令和真實 codex exec 的包裝分叉。
bwrap_sandbox_prefix() {
  local -n dest=$1
  assert_sandbox_layout
  local scratch="$PREREG_SANDBOX_SCRATCH"
  local repo="$PREREG_SANDBOX_REPO"
  ensure_codex_daemon_bind
  dest=(
    bwrap
    --unshare-user
    --unshare-pid
    --die-with-parent
    --ro-bind / /
    --bind "$scratch" "$scratch"
    --bind "$PREREG_CODEX_DAEMON_BIND" "$PREREG_CODEX_DAEMON_MOUNT"
    --dev /dev
    --proc /proc
  )
  local extra
  if [ "${PREREG_SANDBOX_EXTRA_WRITES+x}" = x ]; then
    for extra in "${PREREG_SANDBOX_EXTRA_WRITES[@]}"; do
      [ -n "$extra" ] || continue
      case "$extra" in
        "$scratch"|"$scratch"/*) ;;
        *) dest+=(--bind "$extra" "$extra") ;;
      esac
    done
  fi
  # 儲存庫的唯讀掛載必須最後，蓋過前面的可寫掛載。
  dest+=(--ro-bind "$repo" "$repo" --cap-drop ALL --)
}

# 真實 Arm B 的 codex exec 與此相同。不含暫時的 CODEX_HOME；那個環境只給外層 codex sandbox 行程。
boundary_launch_args() {
  local -n dest=$1
  shift
  assert_sandbox_layout
  case "${PREREG_BOUNDARY:-}" in
    codex-landlock)
      dest=(codex sandbox -P prereg-session -C "$PREREG_SANDBOX_SCRATCH" -- "$@")
      ;;
    bwrap-ro)
      local -a bwrap_prefix=()
      bwrap_sandbox_prefix bwrap_prefix
      dest=("${bwrap_prefix[@]}" "$@")
      ;;
    *)
      die "boundary_launch_args 需要 codex-landlock 或 bwrap-ro，目前是 ${PREREG_BOUNDARY:-unset}。"
      ;;
  esac
}

run_codex_sandboxed() {
  assert_sandbox_layout
  ensure_codex_daemon_socket_mountpoint "$(codex_daemon_socket_dir)"
  local daemon_dir owner mode
  daemon_dir="$(codex_daemon_socket_dir)"
  owner="$(stat -c %u "$daemon_dir")"
  mode="$(stat -c %a "$daemon_dir")"
  if [ "$owner" != "$(id -u)" ] || [ "$mode" != "700" ]; then
    die "Codex app-server socket 目錄 $daemon_dir 必須由目前使用者擁有且 mode 0700。沒有 sudo，不能改別人的目錄。"
  fi
  local scratch="$PREREG_SANDBOX_SCRATCH"
  local home extras=() status=0
  home="$(mktemp -d /tmp/prereg-codex-home.XXXXXX)"
  if [ "${PREREG_SANDBOX_EXTRA_WRITES+x}" = x ]; then
    extras=("${PREREG_SANDBOX_EXTRA_WRITES[@]}")
  fi
  write_codex_sandbox_profile "$home/config.toml" "${extras[@]}"
  CODEX_HOME="$home" codex sandbox -P prereg-session -C "$scratch" -- "$@" || status=$?
  rm -rf "$home"
  return "$status"
}

run_bwrap_sandboxed() {
  local -a prefix
  bwrap_sandbox_prefix prefix
  # prefix 含命令名稱 bwrap。
  "${prefix[@]}" "$@"
}

run_sandboxed() {
  case "${PREREG_BOUNDARY:-}" in
    codex-landlock) run_codex_sandboxed "$@" ;;
    bwrap-ro) run_bwrap_sandboxed "$@" ;;
    *) die "run_sandboxed 需要 codex-landlock 或 bwrap-ro，目前是 ${PREREG_BOUNDARY:-unset}。" ;;
  esac
}
