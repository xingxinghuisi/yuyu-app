"""Resolve existing container DATA_DIR/PRIVATE_EXAMS_DIR to host bind mounts."""
import json
from pathlib import PurePosixPath
import sys

container = json.load(sys.stdin)[0]
environment = dict(item.split('=', 1) for item in container['Config']['Env'] if '=' in item)
data = PurePosixPath(environment.get('DATA_DIR', '/data'))
library = PurePosixPath(environment.get('PRIVATE_EXAMS_DIR', str(data / 'private-exams')))


def host_path(path):
    if not path.is_absolute() or '..' in path.parts:
        raise SystemExit('Container data path must be absolute without parent segments')
    for mount in sorted(container['Mounts'], key=lambda m: len(m['Destination']), reverse=True):
        destination = PurePosixPath(mount['Destination'])
        if path.is_relative_to(destination):
            if not mount.get('RW') or mount.get('Type') != 'bind':
                raise SystemExit('Expected a writable host bind mount for private exam data')
            return str(PurePosixPath(mount['Source']) / path.relative_to(destination))
    raise SystemExit('Existing application data is not mapped to a host bind mount')


print(host_path(data))
print(host_path(library))
