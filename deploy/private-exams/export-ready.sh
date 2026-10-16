#!/usr/bin/env bash
set -euo pipefail
umask 077
kit=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ -f "$kit/ready/ready-manifest.json" ]] || { echo 'Build must complete first.' >&2; exit 1; }
archive="$kit/../jlpt-app-ready-v1.tar.gz"
temporary="$archive.tmp"
trap 'rm -f -- "$temporary"' EXIT
tar -czf "$temporary" -C "$kit" library ready install-exam-library.py requirements.txt setup.sh start.sh worker.sh publish.sh detect-paths.py export-ready.sh README.txt
mv -- "$temporary" "$archive"
echo "READY_ARCHIVE=$archive"
sha256sum "$archive"
echo 'Transfer this PRIVATE archive to the existing website VPS; extract to a new kit directory.'
echo 'Then run: bash publish.sh (it prepares its Python runtime automatically).'
