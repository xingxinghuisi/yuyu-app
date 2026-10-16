#!/usr/bin/env bash
# Run on the existing VPS; private data and audio remain in the mounted data directory.
set -euo pipefail

version=v1.5.1
branch=feat/anime-archipelago
if [[ ${1:-} == --help ]]; then
  echo 'Usage: bash update-yuyu.sh [existing-yuyu-repository-directory]'
  exit 0
fi

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  docker_cmd=(sudo docker)
  "${docker_cmd[@]}" info >/dev/null
fi

is_yuyu_repo() {
  local remote
  remote=$(git -C "$1" remote get-url origin 2>/dev/null) || return 1
  [[ $remote =~ ^(https://github\.com/|git@github\.com:)xingxinghuisi/yuyu-app(\.git)?$ ]]
}

app_dir=${1:-}
if [[ -z $app_dir ]] && is_yuyu_repo "$PWD"; then
  app_dir=$PWD
fi
if [[ -z $app_dir ]]; then
  candidates=()
  while IFS= read -r container; do
    [[ -n $container ]] || continue
    candidate=$("${docker_cmd[@]}" inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container")
    if [[ -d $candidate ]] && is_yuyu_repo "$candidate"; then
      candidate=$(cd "$candidate" && pwd -P)
      duplicate=false
      for existing in "${candidates[@]}"; do
        [[ $existing != "$candidate" ]] || duplicate=true
      done
      $duplicate || candidates+=("$candidate")
    fi
  done < <("${docker_cmd[@]}" ps -aq --filter label=com.docker.compose.service=yuyu)
  if [[ ${#candidates[@]} != 1 ]]; then
    echo 'Cannot identify one existing yuyu Git checkout. Pass its absolute directory as the first argument.' >&2
    exit 1
  fi
  app_dir=${candidates[0]}
fi
if ! is_yuyu_repo "$app_dir"; then
  echo 'The selected directory is not the xingxinghuisi/yuyu-app repository.' >&2
  exit 1
fi
cd "$app_dir"
if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
  echo 'Local tracked files have changes. They were preserved; resolve them before updating.' >&2
  exit 1
fi
echo "Updating existing application: $PWD"
git fetch origin "$branch" --tags
target=$(git rev-parse "refs/tags/$version^{commit}")
if [[ $(git rev-parse "refs/remotes/origin/$branch") != "$target" ]]; then
  echo 'The branch no longer matches this release. Stop and use the current deployment instructions.' >&2
  exit 1
fi

# SQLite's backup API includes committed WAL data while the current app keeps running.
"${docker_cmd[@]}" compose exec -T yuyu python -c '
import os, sqlite3
from datetime import datetime, timezone
from pathlib import Path
data = Path(os.environ.get("DATA_DIR", "/data"))
backup = data / "backups" / ("before-v1.5.1-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
backup.mkdir(parents=True, mode=0o700)
private = Path(os.environ.get("PRIVATE_EXAMS_DIR", str(data / "private-exams")))
for source, name in ((data / "app.db", "app.db"), (private / "attempts.sqlite3", "exam-attempts.sqlite3")):
    if not source.is_file():
        if name == "app.db":
            raise SystemExit("Existing learning database missing; no deployment performed")
        continue
    original = sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
    saved = sqlite3.connect(backup / name)
    try:
        original.backup(saved)
        if saved.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise SystemExit("Backup integrity check failed")
    finally:
        saved.close()
        original.close()
print("DATABASE_BACKUP=" + str(backup))
'
previous=$(git rev-parse HEAD)
git switch "$branch"
git pull --ff-only origin "$branch"
[[ $(git rev-parse HEAD) == "$target" ]]
"${docker_cmd[@]}" compose build yuyu
"${docker_cmd[@]}" compose up -d --no-deps yuyu
healthy=false
for ((attempt=1; attempt<=30; attempt++)); do
  if "${docker_cmd[@]}" compose exec -T yuyu python -c '
import json, urllib.request
base = "http://127.0.0.1:8000"
with urllib.request.urlopen(base + "/api/health", timeout=3) as r:
    assert json.load(r)["ok"] is True
with urllib.request.urlopen(base + "/app.js", timeout=3) as r:
    assert "var APP_VERSION = '\''1.5.1'\'';" in r.read().decode("utf-8")
with urllib.request.urlopen(base + "/api/app-shell/worker", timeout=3) as r:
    assert r.headers["Service-Worker-Allowed"] == "/"
with urllib.request.urlopen(base + "/app-update?v=1.5.1", timeout=3) as r:
    assert "exams.js?v=1.5.1" in r.read().decode("utf-8")
' >/dev/null 2>&1; then
    healthy=true
    break
  fi
  echo "Waiting for application health ($attempt/30)..."
  sleep 3
done
if ! $healthy; then
  echo "Health/version verification failed. Database backup was preserved. Previous commit: $previous" >&2
  exit 1
fi
echo "DEPLOY_OK=$version; commit=$target; previous=$previous"
echo 'Refresh the app to load the update. Private exam files require separate installation if not already present.'
