#!/usr/bin/env bash
set -euo pipefail
umask 077
kit=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if [[ ! -x "$kit/.venv/bin/python" ]]; then
  python3 -m venv "$kit/.venv" || { echo 'Install venv first: sudo apt-get install -y python3-venv' >&2; exit 1; }
fi
if ! "$kit/.venv/bin/python" -c 'import importlib.metadata as m; assert m.version("pypdfium2")=="5.14.0" and m.version("Pillow")=="12.3.0"' 2>/dev/null; then
  "$kit/.venv/bin/python" -m pip install -r "$kit/requirements.txt"
fi
