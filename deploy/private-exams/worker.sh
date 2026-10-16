#!/usr/bin/env bash
set -euo pipefail
umask 077
kit=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
trap 'code=$?; if [[ $code != 0 ]]; then echo "BUILD_FAILED; exit=$code; re-run start.sh to resume cached work"; fi' EXIT
echo "Build started: $(date -Is)"
"$kit/.venv/bin/python" -u "$kit/install-exam-library.py" --bundle "$kit/library" \
  --source-root "$1" --build-only --build-output "$kit/ready" --cache-dir "$kit/media-cache" --workers 2
echo "BUILD_COMPLETE; $(date -Is); cloud_requests=0"
echo "Publish: bash '$kit/publish.sh'"
