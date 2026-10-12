#!/usr/bin/env python3
"""Verify an uploaded pack, then activate it atomically. Keep old releases for rollback."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import tempfile
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import voicevox_audio as pack

SAFE_MEMBER = re.compile(r'(manifest\.json|words/[A-Za-z0-9_-]+\.mp3|examples/[a-f0-9]{64}\.mp3)\Z')


def install(archive_path, data_dir):
    data_dir = Path(data_dir).resolve()
    records = pack.catalog(data_dir / 'app.db')  # Read only; never change learning records.
    root = data_dir / 'audio' / 'voicevox'
    releases = root / 'releases'
    releases.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.import-', dir=releases) as temporary:
        stage = Path(temporary) / 'pack'
        stage.mkdir()
        seen, total = set(), 0
        with tarfile.open(archive_path, 'r:gz') as archive:
            for member in archive:
                total += member.size
                if (not member.isfile() or not SAFE_MEMBER.fullmatch(member.name)
                        or member.name in seen or member.size > 32 * 1024 * 1024
                        or total > 2 * 1024**3 or len(seen) >= 100000):
                    raise ValueError(f'Unsafe or oversized audio archive member: {member.name}')
                seen.add(member.name)
                target = stage / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open('wb') as destination:
                    shutil.copyfileobj(source, destination)
        manifest = pack.verify_pack(stage, records)
        release = 'no7-' + hashlib.sha256((stage / 'manifest.json').read_bytes()).hexdigest()
        target = releases / release
        if target.exists():
            pack.verify_pack(target, records)
        else:
            os.replace(stage, target)
        active = root / 'active.json'
        previous = json.loads(active.read_text('utf-8')).get('release') if active.exists() else None
        pointer = root / f'.active-{uuid.uuid4().hex}.tmp'
        pointer.write_text(json.dumps({'release': release, 'previous_release': previous,
                                       'credit': 'VOICEVOX:No.7'}), encoding='utf-8')
        os.replace(pointer, active)
    print(f'AUDIO_ACTIVE={release}; files={len(records)}; previous={previous or "original recordings"}')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('--data-dir', required=True, help='Actual host directory mounted as /data in yuyu')
    args = parser.parse_args()
    install(args.archive, args.data_dir)


if __name__ == '__main__':
    main()
