#!/usr/bin/env bash
# Publish privately rendered media to one existing yuyu Docker deployment.
set -euo pipefail
umask 077
kit=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
app_dir=''
owner_args=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --app-dir) app_dir=$2; shift 2 ;;
    --owner) owner_args=(--owner "$2"); shift 2 ;;
    *) echo 'Usage: bash publish.sh [--app-dir /existing/yuyu/repo] [--owner WEBSITE_USERNAME]' >&2; exit 1 ;;
  esac
done
[[ -f "$kit/ready/ready-manifest.json" ]] || { echo 'BUILD_COMPLETE is required before publication.' >&2; exit 1; }
bash "$kit/setup.sh"
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then docker_cmd=(sudo docker); "${docker_cmd[@]}" info >/dev/null; fi
is_yuyu_repo() {
  local remote
  remote=$(git -C "$1" remote get-url origin 2>/dev/null) || return 1
  [[ $remote =~ ^(https://github\.com/|git@github\.com:)xingxinghuisi/yuyu-app(\.git)?$ ]]
}
if [[ -z $app_dir ]]; then
  candidates=()
  while IFS= read -r container; do
    [[ -n $container ]] || continue
    candidate=$("${docker_cmd[@]}" inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container")
    if [[ -d $candidate ]] && is_yuyu_repo "$candidate"; then
      candidate=$(cd -- "$candidate" && pwd -P)
      duplicate=false
      for existing in "${candidates[@]}"; do [[ $candidate != "$existing" ]] || duplicate=true; done
      $duplicate || candidates+=("$candidate")
    fi
  done < <("${docker_cmd[@]}" ps -q --filter label=com.docker.compose.service=yuyu)
  if [[ ${#candidates[@]} != 1 ]]; then
    echo 'Ready files are complete; no unique running yuyu application was found on this VPS.' >&2
    echo "If the website is on another server, run: bash '$kit/export-ready.sh'" >&2
    echo 'Otherwise pass --app-dir /absolute/existing/yuyu/repository.' >&2
    exit 1
  fi
  app_dir=${candidates[0]}
fi
is_yuyu_repo "$app_dir" || { echo 'Selected directory is not the existing yuyu repository.' >&2; exit 1; }
curl -fL --retry 0 --connect-timeout 20 'https://raw.githubusercontent.com/xingxinghuisi/yuyu-app/v1.5.1/deploy/update-yuyu.sh' -o "$kit/update-yuyu.sh"
bash "$kit/update-yuyu.sh" "$app_dir"
container=$(cd -- "$app_dir" && "${docker_cmd[@]}" compose ps -q yuyu)
[[ -n $container && $container != *$'\n'* ]] || { echo 'Expected one running yuyu container.' >&2; exit 1; }
paths=$("${docker_cmd[@]}" inspect "$container" | "$kit/.venv/bin/python" "$kit/detect-paths.py")
mapfile -t host_paths <<<"$paths"
[[ ${#host_paths[@]} == 2 ]] || { echo 'Could not resolve application data directories.' >&2; exit 1; }
python_cmd=("$kit/.venv/bin/python")
if [[ $EUID != 0 ]]; then python_cmd=(sudo "${python_cmd[@]}"); fi
"${python_cmd[@]}" -u "$kit/install-exam-library.py" --bundle "$kit/library" --ready-root "$kit/ready" \
  --data-dir "${host_paths[0]}" --library-dir "${host_paths[1]}" --cache-dir "$kit/publish-cache" "${owner_args[@]}" --install
echo 'PRIVATE_EXAMS_DEPLOYED; refresh the app, open Exams, and select level/year/month.'
