"""Pinned word recordings downloaded on demand into the persistent volume."""
import hashlib
import os
import re
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

_locks = defaultdict(threading.Lock)
_failed_until = {}
MAX_AUDIO_BYTES = 4 * 1024 * 1024
PINNED_COMMIT = '853798a4dec3630cad1984aa1c7edab31b09d109'


def get_audio(source, cache_dir):
    filename, blob, commit = source['filename'], source['git_blob_sha1'], source['commit_sha']
    if (commit != PINNED_COMMIT or not re.fullmatch(r'[0-9a-f]{40}', blob)
            or not filename.endswith('.mp3') or any(c in filename for c in '/\\\x00\r\n')):
        raise ValueError('Invalid pinned audio reference')
    directory = Path(cache_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (blob + '.mp3')
    with _locks[blob]:
        if path.is_file():
            return path
        if time.monotonic() < _failed_until.get(blob, 0):
            raise OSError('Upstream audio temporarily unavailable')
        url = ('https://raw.githubusercontent.com/5mdld/anki-jlpt-decks/' + commit
               + '/deck-source/medias/' + urllib.parse.quote(filename, safe=''))
        partial = None
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'Yuyu-Kotoba/1.3'})
            with urllib.request.urlopen(request, timeout=6) as response:
                data = response.read(MAX_AUDIO_BYTES + 1)
            if not data or len(data) > MAX_AUDIO_BYTES:
                raise OSError('Invalid audio size')
            actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            if actual != blob:
                raise OSError('Upstream audio checksum mismatch')
            with tempfile.NamedTemporaryFile(dir=directory, suffix='.partial', delete=False) as handle:
                partial = Path(handle.name)
                handle.write(data)
            os.replace(partial, path)
            _failed_until.pop(blob, None)
            return path
        except Exception:
            _failed_until[blob] = time.monotonic() + 60
            raise
        finally:
            if partial is not None and partial.exists():
                partial.unlink()
