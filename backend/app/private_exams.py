"""Personal exam packs live under DATA_DIR, never under the public static mount."""
import json
import os
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StrictBool, StrictInt


class StartIn(BaseModel):
    section_id: str
    mode: str = 'practice'
    restart: StrictBool = False


class SaveIn(BaseModel):
    answers: dict[str, StrictInt | None] = Field(default_factory=dict)
    marked: dict[str, StrictBool] = Field(default_factory=dict)
    cursor: str | None = None
    audio_position: float | None = Field(default=None, ge=0, le=86400, allow_inf_nan=False)


def root_dir():
    override = os.environ.get('PRIVATE_EXAMS_DIR')
    return Path(override).resolve() if override else Path(os.environ.get('DATA_DIR', '/data')).resolve() / 'private-exams'


def load_pack(exam_id):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', exam_id):
        raise HTTPException(404, '试卷不存在')
    root = root_dir().resolve()
    folder = (root / exam_id).resolve()
    if folder.parent != root:
        raise HTTPException(404, '试卷不存在')
    try:
        data = json.loads((folder / 'exam.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise HTTPException(404, '试卷不存在')
    return folder, data


@contextmanager
def database():
    root = root_dir()
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(root / 'attempts.sqlite3', timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('''CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, exam_id TEXT NOT NULL,
        section_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
        started_at REAL NOT NULL, deadline_at REAL, submitted_at REAL,
        answers TEXT NOT NULL DEFAULT '{}', marked TEXT NOT NULL DEFAULT '{}',
        cursor TEXT, audio_position REAL NOT NULL DEFAULT 0)''')
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def public_pack(pack):
    return {key: pack[key] for key in ('id', 'title', 'level', 'year', 'month', 'sections', 'questions')}


def question_view(question):
    return {key: value for key, value in question.items()
            if key not in ('correct', 'explanation_pages', 'answer_key_page')}


def serialize_attempt(row, pack):
    result = dict(row)
    result['answers'] = json.loads(row['answers'])
    result['marked'] = json.loads(row['marked'])
    questions = [q for q in pack['questions'] if q['section_id'] == row['section_id']]
    result['server_now'] = time.time()
    if row['status'] == 'submitted':
        correct = sum(result['answers'].get(q['id']) == q['correct'] for q in questions)
        answered = sum(q['id'] in result['answers'] for q in questions)
        result['score'] = {'correct': correct, 'total': len(questions), 'answered': answered,
                           'accuracy': round(100 * correct / len(questions), 1)}
        result['review'] = [dict(q, selected=result['answers'].get(q['id']),
                                is_correct=result['answers'].get(q['id']) == q['correct'])
                            for q in questions]
    return result


def get_attempt(conn, attempt_id, user_id):
    row = conn.execute('SELECT * FROM attempts WHERE id=? AND user_id=?', (attempt_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(404, '考试记录不存在')
    # Deadlines are authoritative on the server, including while the browser was closed.
    if row['status'] == 'active' and row['deadline_at'] is not None and time.time() >= row['deadline_at']:
        conn.execute("UPDATE attempts SET status='submitted', submitted_at=? WHERE id=?",
                     (row['deadline_at'], attempt_id))
        row = conn.execute('SELECT * FROM attempts WHERE id=?', (attempt_id,)).fetchone()
    return row


def create_router(current_user):
    def no_store(response: Response):
        response.headers['Cache-Control'] = 'private, no-store'

    router = APIRouter(prefix='/api/private-exams', tags=['personal exams'], dependencies=[Depends(no_store)])

    def authorize(user):
        try:
            access = json.loads((root_dir() / 'access.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise HTTPException(403, '个人题库尚未配置')
        if user['username'] != access.get('owner_username'):
            raise HTTPException(403, '这是个人题库，仅限资料所有者访问')
        return user

    async def owner(authorization: str | None = Header(default=None)):
        return authorize(await current_user(authorization))

    async def media_owner(authorization: str | None = Header(default=None),
                          yuyu_exam: str | None = Cookie(default=None)):
        value = authorization or ('Bearer ' + yuyu_exam if yuyu_exam else None)
        return authorize(await current_user(value))

    @router.post('/media-session')
    def media_session(request: Request, response: Response, user=Depends(owner),
                      authorization: str = Header()):
        response.set_cookie('yuyu_exam', authorization[7:].strip(), httponly=True,
                            secure=request.url.scheme == 'https', samesite='strict',
                            path='/api/private-exams', max_age=10800)
        response.headers['Cache-Control'] = 'no-store'
        return {'ok': True}

    @router.delete('/media-session', status_code=204)
    def end_media_session(response: Response):
        response.delete_cookie('yuyu_exam', path='/api/private-exams', samesite='strict')

    @router.get('')
    def catalog(user=Depends(owner)):
        exams = []
        for path in sorted(root_dir().glob('*/exam.json')):
            _, pack = load_pack(path.parent.name)
            exams.append({key: pack[key] for key in ('id', 'title', 'level', 'year', 'month', 'sections')})
        return {'exams': exams}

    @router.get('/attempts/{attempt_id}')
    def read_attempt(attempt_id: str, user=Depends(owner)):
        with database() as conn:
            row = get_attempt(conn, attempt_id, user['id'])
            _, pack = load_pack(row['exam_id'])
            return serialize_attempt(row, pack)

    @router.put('/attempts/{attempt_id}')
    def save_attempt(attempt_id: str, body: SaveIn, user=Depends(owner)):
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = get_attempt(conn, attempt_id, user['id'])
            _, pack = load_pack(row['exam_id'])
            if row['status'] != 'active':
                return serialize_attempt(row, pack)
            questions = {q['id']: q for q in pack['questions'] if q['section_id'] == row['section_id']}
            if (set(body.answers) | set(body.marked)) - questions.keys() or (body.cursor and body.cursor not in questions):
                raise HTTPException(422, '题号不属于当前考试分区')
            for key, value in body.answers.items():
                if value is not None and not 1 <= value <= questions[key]['option_count']:
                    raise HTTPException(422, '选项超出范围')
            answers, marked = json.loads(row['answers']), json.loads(row['marked'])
            for key, value in body.answers.items():
                if value is None:
                    answers.pop(key, None)
                else:
                    answers[key] = value
            marked.update(body.marked)
            conn.execute('UPDATE attempts SET answers=?, marked=?, cursor=?, audio_position=? WHERE id=?',
                         (json.dumps(answers), json.dumps(marked), body.cursor or row['cursor'],
                          body.audio_position if body.audio_position is not None else row['audio_position'], attempt_id))
            return serialize_attempt(get_attempt(conn, attempt_id, user['id']), pack)

    @router.post('/attempts/{attempt_id}/submit')
    def submit(attempt_id: str, user=Depends(owner)):
        with database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = get_attempt(conn, attempt_id, user['id'])
            if row['status'] == 'active':
                conn.execute("UPDATE attempts SET status='submitted', submitted_at=? WHERE id=?", (time.time(), attempt_id))
            row = get_attempt(conn, attempt_id, user['id'])
            _, pack = load_pack(row['exam_id'])
            return serialize_attempt(row, pack)

    @router.get('/{exam_id}')
    def exam(exam_id: str, user=Depends(owner)):
        _, pack = load_pack(exam_id)
        result = public_pack(pack)
        result['questions'] = [question_view(q) for q in pack['questions']]
        return result

    @router.get('/{exam_id}/attempts')
    def history(exam_id: str, user=Depends(owner)):
        _, pack = load_pack(exam_id)
        with database() as conn:
            # One visible record per exam section, including attempts made before this change.
            ids = conn.execute('''SELECT a.id FROM attempts a WHERE a.user_id=? AND a.exam_id=?
                AND a.rowid=(SELECT b.rowid FROM attempts b
                    WHERE b.user_id=a.user_id AND b.exam_id=a.exam_id AND b.section_id=a.section_id
                    ORDER BY b.started_at DESC,b.rowid DESC LIMIT 1)
                ORDER BY a.started_at DESC,a.rowid DESC''', (user['id'], exam_id)).fetchall()
            return {'attempts': [serialize_attempt(get_attempt(conn, item['id'], user['id']), pack) for item in ids]}

    @router.post('/{exam_id}/attempts', status_code=201)
    def start(exam_id: str, body: StartIn, response: Response, user=Depends(owner)):
        _, pack = load_pack(exam_id)
        sections = {s['id']: s for s in pack['sections']}
        if body.section_id not in sections or body.mode not in ('practice', 'timed'):
            raise HTTPException(422, '考试分区或模式无效')
        started = time.time()
        deadline = started + sections[body.section_id]['minutes'] * 60 if body.mode == 'timed' else None
        first = next(q['id'] for q in pack['questions'] if q['section_id'] == body.section_id)
        attempt_id = uuid.uuid4().hex
        with database() as conn:
            # Serialize simultaneous clicks/tabs so default entry cannot create duplicates.
            conn.execute('BEGIN IMMEDIATE')
            latest = conn.execute('''SELECT id FROM attempts WHERE user_id=? AND exam_id=? AND section_id=?
                ORDER BY started_at DESC,rowid DESC LIMIT 1''', (user['id'], exam_id, body.section_id)).fetchone()
            if latest and not body.restart:
                existing = get_attempt(conn, latest['id'], user['id'])
                if existing['status'] == 'active':
                    response.status_code = 200
                    return dict(serialize_attempt(existing, pack), resumed=True)
            conn.execute('INSERT INTO attempts (id,user_id,exam_id,section_id,mode,status,started_at,deadline_at,cursor) '
                         "VALUES (?,?,?,?,?,'active',?,?,?)",
                         (attempt_id, user['id'], exam_id, body.section_id, body.mode, started, deadline, first))
            return dict(serialize_attempt(get_attempt(conn, attempt_id, user['id']), pack), resumed=False)

    @router.get('/{exam_id}/assets/{kind}/{filename}')
    def asset(exam_id: str, kind: str, filename: str, attempt: str | None = None, user=Depends(media_owner)):
        folder, pack = load_pack(exam_id)
        if kind not in ('paper', 'answers', 'questions') or not re.fullmatch(r'[a-z0-9-]+\.webp', filename):
            raise HTTPException(404, '文件不存在')
        if kind == 'answers':
            with database() as conn:
                row = get_attempt(conn, attempt or '', user['id'])
                if row['exam_id'] != exam_id or row['status'] != 'submitted':
                    raise HTTPException(403, '交卷后才能查看解析与听力原文')
        path = (folder / 'assets' / kind / filename).resolve()
        if not path.is_relative_to(folder) or not path.is_file():
            raise HTTPException(404, '文件不存在')
        return FileResponse(path, media_type='image/webp', headers={'Cache-Control': 'private, no-store'})

    @router.get('/{exam_id}/audio')
    def audio(exam_id: str, user=Depends(media_owner)):
        folder, _ = load_pack(exam_id)
        path = (folder / 'source' / 'listening.mp3').resolve()
        if not path.is_relative_to(folder) or not path.is_file():
            raise HTTPException(404, '听力音频尚未导入')
        return FileResponse(path, media_type='audio/mpeg', headers={'Cache-Control': 'private, no-store'})

    return router
