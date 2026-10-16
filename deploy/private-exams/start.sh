#!/usr/bin/env bash
# Run from the private distribution kit, next to library/ and the installer.
set -euo pipefail
umask 077
kit=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
source_dir=${1:-"$kit/../source"}
[[ -f "$kit/library/manifest.json" ]] || { echo 'Private kit is missing.' >&2; exit 1; }
bash "$kit/setup.sh"
if [[ -f "$kit/ready/ready-manifest.json" ]]; then
  echo "BUILD_COMPLETE already exists. Publish: bash '$kit/publish.sh'"
  exit 0
fi
[[ -d "$source_dir" ]] || { echo 'Original source directory is missing.' >&2; exit 1; }
if [[ -f "$kit/build.pid" ]]; then
  pid=$(cat "$kit/build.pid")
  if [[ $pid =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null &&
     [[ -r /proc/$pid/cmdline ]] && grep -Fq "$kit/worker.sh" "/proc/$pid/cmdline"; then
    echo "Build already running: PID=$pid"
    echo "Progress: tail -n 20 '$kit/build.log'"
    exit 0
  fi
fi
nohup bash "$kit/worker.sh" "$source_dir" >>"$kit/build.log" 2>&1 </dev/null &
pid=$!
printf '%s\n' "$pid" >"$kit/build.pid"
echo "Started PID=$pid; safe to close SSH. Cloud requests: 0."
echo "Progress: tail -n 20 '$kit/build.log'"
echo "When BUILD_COMPLETE appears: bash '$kit/publish.sh'"
