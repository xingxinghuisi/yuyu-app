"""In-process FastAPI transport for environments without cross-process loopback.

No mock responses: requests run through the real ASGI app and isolated SQLite DB.
Requires httpx in the test environment, in addition to backend requirements.
"""
import base64
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / '.runtime'), str(ROOT / 'backend'), str(ROOT)]
os.environ['DATA_DIR'] = str(ROOT / 'data' / 'map-tests')
os.environ['JWT_SECRET'] = 'in-process-test-secret-never-used-in-production'
from fastapi.testclient import TestClient
from app.main import app

with TestClient(app) as client:
    if '--smoke' in sys.argv:
        import smoke_test
        import io
        from urllib.parse import urlsplit
        smoke_test.BASE = 'http://testserver'
        def urlopen(req, **kwargs):
            url = urlsplit(req.full_url)
            response = client.request(req.get_method(), url.path + ('?' + url.query if url.query else ''))
            body = io.BytesIO(response.content)
            body.status = response.status_code
            body.headers = response.headers
            return body
        smoke_test.urllib.request.urlopen = urlopen
        def api(method, path, body=None, token=None):
            response = client.request(method, path, json=body,
                headers={'Authorization': 'Bearer ' + token} if token else {})
            return response.status_code, response.json() if response.content else None
        smoke_test.api = api
        smoke_test.main()
    else:
        for line in sys.stdin:
            req = json.loads(line)
            response = client.request(req.get('method', 'GET'), req['path'],
                json=req.get('data'), headers=req.get('headers', {}))
            print(json.dumps({'id': req['id'], 'status': response.status_code,
                'contentType': response.headers.get('content-type', 'application/octet-stream'),
                'body': base64.b64encode(response.content).decode('ascii')}, ensure_ascii=True), flush=True)
