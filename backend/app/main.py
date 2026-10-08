"""语屿 Kotoba MVP 后端。

启动:  cd backend && DATA_DIR=../data uvicorn app.main:app --port 8000
日期一律使用 Asia/Shanghai 时区的"今天"。
"""

import json
import os
import random
import sqlite3
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth, seed_db, srs

# ---------------- 基础 ----------------

SH = ZoneInfo("Asia/Shanghai")
LEVELS = ("N5", "N4", "N3", "N2", "N1")
QUIZ_TYPES = ("choice_ja", "choice_zh", "listening")  # v0.3: 砍掉 spelling 打字题
# 内存 quiz 状态: (user_id, qid) -> {word_id, type, expected}
QUIZ_STORE: dict = {}
_write_lock = threading.Lock()


def now_dt() -> datetime:
    return datetime.now(SH)


def today_str() -> str:
    return now_dt().strftime("%Y-%m-%d")


def now_iso() -> str:
    return now_dt().strftime("%Y-%m-%dT%H:%M:%S")


def db_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "app.db")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="unauthorized")


async def current_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized()
    uid = auth.decode_token(authorization[7:].strip())
    if uid is None:
        raise unauthorized()
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    finally:
        conn.close()
    if row is None:
        raise unauthorized()
    return dict(row)


async def optional_user(authorization: str | None = Header(default=None)):
    """可选认证: 有合法 token 则返回用户, 否则 None（公开接口用）。"""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return await current_user(authorization)
    except HTTPException:
        return None


def me_dict(row: dict) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "phone": row["phone"],
        "pro": row["pro"],
        "lang": row.get("lang") or "zh",
        "daily_goal": row.get("daily_goal") or 30,
        "created_at": row["created_at"],
    }


# ---------------- 词条序列化 ----------------

LANGS = ("zh", "en")


def display_meaning(row, lang: str = "zh") -> tuple[str, bool]:
    """返回 (显示释义, 是否为英文回退)。

    en 模式: 直接用 meaning_en; zh 模式: meaning_zh 优先, 缺失则回退 meaning_en。
    """
    if lang == "en":
        return (row["meaning_en"] or ""), False
    m_zh = row["meaning_zh"]
    if m_zh:
        return m_zh, False
    return (row["meaning_en"] or ""), True


def word_display(row) -> str:
    return row["kanji"] if row["kanji"] else row["kana"]


def example_display_sentence(e, lang: str = "zh") -> str:
    if lang == "en":
        return e["sentence_en"] or ""
    return e["sentence_zh"] or e["sentence_en"] or ""


def word_to_dict(row, conn: sqlite3.Connection, lang: str = "zh") -> dict:
    dm, fallback = display_meaning(row, lang)
    try:
        pos = json.loads(row["pos"]) if row["pos"] else []
    except Exception:
        pos = []
    ex_rows = conn.execute(
        "SELECT sentence_ja, furigana, sentence_en, sentence_zh"
        " FROM examples WHERE word_id=? ORDER BY id",
        (row["id"],),
    ).fetchall()
    examples = [
        {"ja": e["sentence_ja"], "furigana": e["furigana"],
         "en": e["sentence_en"], "zh": e["sentence_zh"],
         "display_sentence": example_display_sentence(e, lang)}
        for e in ex_rows
    ]
    # 形: 按词的 kanji 逐字关联 kanji 表 (笔画/音训/英文释义); 查不到则为空列表
    kanji_info = []
    try:
        for ch in (row["kanji"] or ""):
            kr = conn.execute(
                "SELECT character, strokes, onyomi, kunyomi, meanings, meaning_zh"
                " FROM kanji WHERE character=?", (ch,)).fetchone()
            if kr:
                kanji_info.append({
                    "character": kr["character"], "strokes": kr["strokes"],
                    "onyomi": json.loads(kr["onyomi"]) if kr["onyomi"] else [],
                    "kunyomi": json.loads(kr["kunyomi"]) if kr["kunyomi"] else [],
                    "meanings": json.loads(kr["meanings"]) if kr["meanings"] else [],
                    "meaning_zh": kr["meaning_zh"],
                })
    except Exception:
        kanji_info = []
    return {
        "id": row["id"],
        "kanji": row["kanji"],
        "kana": row["kana"],
        "romaji": row["romaji"],
        "meaning_zh": row["meaning_zh"],
        "meaning_en": row["meaning_en"],
        "display_meaning": dm,
        "meaning_is_en_fallback": fallback,
        "zh_source": row["zh_source"] if "zh_source" in row.keys() else None,
        "mnemonic_zh": row["mnemonic_zh"] if "mnemonic_zh" in row.keys() else None,
        "kanji_info": kanji_info,
        "pos": pos,
        "level": row["level"],
        "examples": examples,
    }


def fetch_word(conn: sqlite3.Connection, word_id: str):
    return conn.execute("SELECT * FROM words WHERE id=?", (word_id,)).fetchone()


# ---------------- App ----------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_db.init_db()
    yield


app = FastAPI(title="语屿 Kotoba API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "time": now_iso()}


# ---------------- 请求模型 ----------------

class RegisterIn(BaseModel):
    username: str
    password: str


class LoginIn(BaseModel):
    username: str
    password: str


class ProfileIn(BaseModel):
    email: str | None = None
    phone: str | None = None
    lang: str | None = None
    daily_goal: int | None = None


class StudyPlanIn(BaseModel):
    level: str = "N5"
    order: str = "seq"
    book_id: str | None = None  # v0.4: 指定词书; 为空则按 level 回退


class AnswerIn(BaseModel):
    word_id: str
    grade: int = Field(ge=0, le=5)


class QuizStartIn(BaseModel):
    level: str = "N5"
    count: int = Field(default=20, ge=1, le=50)
    word_ids: list[str] | None = None
    mode: str = "normal"  # normal | exam_freq | jees_sample


class QuizAnswerItem(BaseModel):
    qid: str
    answer: str


class QuizSubmitIn(BaseModel):
    qid_answers: list[QuizAnswerItem]


# ---------------- 认证 ----------------

@app.post("/api/auth/register", status_code=201)
def register(body: RegisterIn):
    username = (body.username or "").strip()
    password = body.password or ""
    if not auth.validate_username(username):
        raise HTTPException(status_code=400, detail="invalid username: 3-20 chars of A-Za-z0-9_")
    if not auth.validate_password(password):
        raise HTTPException(status_code=400, detail="invalid password: >=8 chars with letters and digits")
    conn = get_db()
    try:
        exists = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="username already exists")
        with _write_lock:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)",
                (username, auth.hash_password(password), now_iso()),
            )
            conn.commit()
        return {"id": cur.lastrowid, "username": username}
    finally:
        conn.close()


@app.post("/api/auth/login")
def login(body: LoginIn):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE username=?", ((body.username or "").strip(),)
        ).fetchone()
    finally:
        conn.close()
    if row is None or not auth.verify_password(body.password or "", row["password_hash"]):
        raise unauthorized()
    row = dict(row)
    return {
        "token": auth.create_token(row["id"]),
        "user": {"id": row["id"], "username": row["username"],
                 "pro": row["pro"], "lang": row.get("lang") or "zh"},
    }


@app.get("/api/auth/me")
def get_me(user: dict = Depends(current_user)):
    return me_dict(user)


@app.put("/api/auth/profile")
def update_profile(body: ProfileIn, user: dict = Depends(current_user)):
    updates: dict = {}
    if body.email is not None:
        email = body.email.strip()
        if email == "":
            updates["email"] = None
        elif not auth.validate_email(email):
            raise HTTPException(status_code=400, detail="invalid email")
        else:
            updates["email"] = email
    if body.phone is not None:
        phone = body.phone.strip()
        if phone == "":
            updates["phone"] = None
        else:
            ok, normalized = auth.normalize_phone(phone)
            if not ok:
                raise HTTPException(status_code=400, detail="invalid phone")
            updates["phone"] = normalized
    if body.lang is not None:
        lang = body.lang.strip().lower()
        if lang not in LANGS:
            raise HTTPException(status_code=400, detail="invalid lang: must be 'zh' or 'en'")
        updates["lang"] = lang
    if body.daily_goal is not None:
        try:
            dg = int(body.daily_goal)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="invalid daily_goal")
        if dg < 1 or dg > 200:
            raise HTTPException(status_code=400, detail="invalid daily_goal: must be 1-200")
        updates["daily_goal"] = dg
    conn = get_db()
    try:
        if updates:
            with _write_lock:
                sets = ", ".join(f"{k}=?" for k in updates)
                conn.execute(
                    f"UPDATE users SET {sets} WHERE id=?",
                    (*updates.values(), user["id"]),
                )
                conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    finally:
        conn.close()
    return me_dict(dict(row))


@app.delete("/api/auth/account")
def delete_account(user: dict = Depends(current_user)):
    conn = get_db()
    try:
        with _write_lock:
            conn.execute("DELETE FROM user_words WHERE user_id=?", (user["id"],))
            conn.execute("DELETE FROM study_logs WHERE user_id=?", (user["id"],))
            conn.execute("DELETE FROM checkins WHERE user_id=?", (user["id"],))
            conn.execute("DELETE FROM users WHERE id=?", (user["id"],))
            conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ---------------- 词库 ----------------

@app.get("/api/vocab")
def list_vocab(
    level: str = Query("N5", pattern="^N[1-5]$"),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    lang: str | None = Query(None, pattern="^(zh|en)$"),
    user: dict | None = Depends(optional_user),
):
    eff_lang = lang or (user.get("lang") if user else None) or "zh"
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM words WHERE level=? ORDER BY kana LIMIT ? OFFSET ?",
            (level, limit, offset),
        ).fetchall()
        return [word_to_dict(r, conn, eff_lang) for r in rows]
    finally:
        conn.close()


@app.get("/api/vocab/{word_id}")
def get_vocab(
    word_id: str,
    lang: str | None = Query(None, pattern="^(zh|en)$"),
    user: dict | None = Depends(optional_user),
):
    eff_lang = lang or (user.get("lang") if user else None) or "zh"
    conn = get_db()
    try:
        row = fetch_word(conn, word_id)
        if row is None:
            raise HTTPException(status_code=404, detail="word not found")
        return word_to_dict(row, conn, eff_lang)
    finally:
        conn.close()


# ---------------- 书架 ----------------

@app.get("/api/books")
def get_books(user: dict = Depends(current_user)):
    """v0.4: 返回词书列表 (按 category 分组由前端做)。
    每本: id/name/category/level/description/total/studied/progress。"""
    conn = get_db()
    try:
        books = []
        for b in conn.execute("SELECT * FROM books ORDER BY sort_order").fetchall():
            b = dict(b)
            total = conn.execute(
                "SELECT COUNT(*) AS c FROM book_words WHERE book_id=?", (b["id"],)
            ).fetchone()["c"]
            studied = conn.execute(
                """SELECT COUNT(DISTINCT uw.word_id) AS c FROM user_words uw
                   JOIN book_words bw ON bw.word_id = uw.word_id
                   WHERE uw.user_id=? AND bw.book_id=?""",
                (user["id"], b["id"]),
            ).fetchone()["c"]
            books.append({
                "id": b["id"], "name": b["name"], "category": b["category"],
                "level": b["level"], "description": b["description"],
                "total": total, "studied": studied,
                "progress": round(studied / total, 2) if total else 0.0,
            })
        # 兜底: books 表为空 (极旧库) 则按 level 生成
        if not books:
            for level in LEVELS:
                total = conn.execute(
                    "SELECT COUNT(*) AS c FROM words WHERE level=?", (level,)
                ).fetchone()["c"]
                studied = conn.execute(
                    """SELECT COUNT(DISTINCT uw.word_id) AS c FROM user_words uw
                       JOIN words w ON w.id = uw.word_id
                       WHERE uw.user_id=? AND w.level=?""",
                    (user["id"], level),
                ).fetchone()["c"]
                books.append({"id": f"level-{level.lower()}", "name": level,
                              "category": "level", "level": level, "description": "",
                              "total": total, "studied": studied,
                              "progress": round(studied / total, 2) if total else 0.0})
        return books
    finally:
        conn.close()


# ---------------- 学习 ----------------

@app.post("/api/study/plan")
def study_plan(body: StudyPlanIn | None = None, user: dict = Depends(current_user)):
    level = (body.level if body else None) or "N5"
    if level not in LEVELS:
        raise HTTPException(status_code=400, detail="invalid level")
    order = (body.order if body else None) or "seq"
    if order not in ("seq", "shuffle"):
        raise HTTPException(status_code=400, detail="invalid order: must be 'seq' or 'shuffle'")
    book_id = (body.book_id if body else None) or None
    lang = user.get("lang") or "zh"
    ordering = "ORDER BY bw.sort_order" if order == "seq" else "ORDER BY RANDOM()"
    conn = get_db()
    try:
        if book_id:
            brow = conn.execute("SELECT id FROM books WHERE id=?", (book_id,)).fetchone()
            if brow is None:
                raise HTTPException(status_code=400, detail="invalid book_id")
            rows = conn.execute(
                f"""SELECT w.* FROM words w
                   JOIN book_words bw ON bw.word_id = w.id
                   WHERE bw.book_id=? AND w.id NOT IN (SELECT word_id FROM user_words WHERE user_id=?)
                   {ordering} LIMIT 30""",
                (book_id, user["id"]),
            ).fetchall()
        else:
            ordering_legacy = "ORDER BY kana" if order == "seq" else "ORDER BY RANDOM()"
            rows = conn.execute(
                f"""SELECT * FROM words WHERE level=?
                   AND id NOT IN (SELECT word_id FROM user_words WHERE user_id=?)
                   {ordering_legacy} LIMIT 30""",
                (level, user["id"]),
            ).fetchall()
        words = [word_to_dict(r, conn, lang) for r in rows]
        today_learned = conn.execute(
            "SELECT COUNT(DISTINCT word_id) AS c FROM study_logs"
            " WHERE user_id=? AND substr(created_at,1,10)=?",
            (user["id"], today_str()),
        ).fetchone()["c"]
        return {"words": words, "daily_goal": user.get("daily_goal") or 30, "today_learned": today_learned}
    finally:
        conn.close()


def upsert_user_word(conn, user_id, word_id, easiness, interval, repetitions, due_at, grade,
                    fsrs_stability=None, fsrs_difficulty=None, fsrs_state=None,
                    fsrs_step=None, fsrs_last_review=None):
    conn.execute(
        """INSERT INTO user_words
           (user_id, word_id, easiness, interval, repetitions, due_at, last_grade, updated_at,
            fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_step, fsrs_last_review)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(user_id, word_id) DO UPDATE SET
             easiness=excluded.easiness, interval=excluded.interval,
             repetitions=excluded.repetitions, due_at=excluded.due_at,
             last_grade=excluded.last_grade, updated_at=excluded.updated_at,
             fsrs_stability=excluded.fsrs_stability, fsrs_difficulty=excluded.fsrs_difficulty,
             fsrs_state=excluded.fsrs_state, fsrs_step=excluded.fsrs_step,
             fsrs_last_review=excluded.fsrs_last_review""",
        (user_id, word_id, easiness, interval, repetitions, due_at, grade, now_iso(),
         fsrs_stability, fsrs_difficulty, fsrs_state, fsrs_step, fsrs_last_review),
    )


@app.post("/api/study/answer")
def study_answer(body: AnswerIn, user: dict = Depends(current_user)):
    conn = get_db()
    try:
        w = fetch_word(conn, body.word_id)
        if w is None:
            raise HTTPException(status_code=404, detail="word not found")
        row = conn.execute(
            "SELECT easiness, interval, repetitions, fsrs_stability, fsrs_difficulty,"
            " fsrs_state, fsrs_step, fsrs_last_review"
            " FROM user_words WHERE user_id=? AND word_id=?",
            (user["id"], body.word_id),
        ).fetchone()
        if row:
            fs = {"stability": row["fsrs_stability"], "difficulty": row["fsrs_difficulty"],
                  "state": row["fsrs_state"], "step": row["fsrs_step"],
                  "last_review": row["fsrs_last_review"]}
            e, i, r = row["easiness"], row["interval"], row["repetitions"]
        else:
            fs = srs.blank_fsrs()
            e, i, r = 2.5, 0, 0
        res = srs.review_fsrs(body.grade, fs, now_dt())
        due_at = res["due"].astimezone(SH).strftime("%Y-%m-%dT%H:%M:%S")
        # Again(1) 则连续正确次数清零, 否则 +1 (统计"已掌握"沿用旧口径)
        r2 = 0 if res["rating"] == 1 else r + 1
        i2 = res["interval_days"]
        with _write_lock:
            upsert_user_word(conn, user["id"], body.word_id, e, i2, r2, due_at, body.grade,
                             fsrs_stability=res["stability"], fsrs_difficulty=res["difficulty"],
                             fsrs_state=res["state"], fsrs_step=res["step"],
                             fsrs_last_review=res["last_review"])
            conn.execute(
                "INSERT INTO study_logs (user_id, word_id, grade, created_at) VALUES (?,?,?,?)",
                (user["id"], body.word_id, body.grade, now_iso()),
            )
            conn.commit()
        return {"word_id": body.word_id, "interval": i2, "repetitions": r2, "due_at": due_at,
                "stability": res["stability"], "difficulty": res["difficulty"],
                "rating": res["rating"]}
    finally:
        conn.close()


@app.post("/api/review/answer")
def review_answer(body: AnswerIn, user: dict = Depends(current_user)):
    """复习自评: 与 study_answer 同一 FSRS 逻辑, 前端复习页调用."""
    return study_answer(body, user)


@app.get("/api/review/due")
def review_due(limit: int = Query(100, ge=1, le=500), user: dict = Depends(current_user)):
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT w.*, uw.easiness AS uw_easiness, uw.interval AS uw_interval,
                      uw.repetitions AS uw_repetitions
               FROM user_words uw JOIN words w ON w.id = uw.word_id
               WHERE uw.user_id=? AND uw.due_at <= ?
               ORDER BY uw.due_at ASC LIMIT ?""",
            (user["id"], now_iso(), limit),
        ).fetchall()
        out = []
        lang = user.get("lang") or "zh"
        for r in rows:
            d = word_to_dict(r, conn, lang)
            d["easiness"] = r["uw_easiness"]
            d["interval"] = r["uw_interval"]
            d["repetitions"] = r["uw_repetitions"]
            out.append(d)
        return out
    finally:
        conn.close()


# ---------------- 测验 ----------------

def _distinct_samples(pool: list, exclude: str, key, n: int):
    seen = {exclude}
    out = []
    for w in pool:
        k = key(w)
        if k in seen:
            continue
        seen.add(k)
        out.append(k)
        if len(out) >= n:
            break
    return out


@app.post("/api/quiz/start")
def quiz_start(body: QuizStartIn, user: dict = Depends(current_user)):
    level = body.level or "N5"
    if level not in LEVELS:
        raise HTTPException(status_code=400, detail="invalid level")
    lang = user.get("lang") or "zh"
    conn = get_db()
    try:
        if body.word_ids is not None:
            ids = [i for i in dict.fromkeys(body.word_ids) if i][:50]
            if not ids:
                raise HTTPException(status_code=400, detail="word_ids is empty")
            placeholders = ",".join("?" for _ in ids)
            rows = [dict(r) for r in conn.execute(
                f"SELECT * FROM words WHERE id IN ({placeholders})", ids
            ).fetchall()]
            if not rows:
                raise HTTPException(status_code=400, detail="no valid words for word_ids")
        else:
            if body.mode == "exam_freq":
                # 真题高频模式: 按考频加权抽题 (high 权重 4, mid 2, low 1, null 0.5)
                rows = [dict(r) for r in conn.execute(
                    "SELECT * FROM words WHERE level=? AND exam_freq IS NOT NULL", (level,)
                ).fetchall()]
                if not rows:
                    rows = [dict(r) for r in conn.execute(
                        "SELECT * FROM words WHERE level=?", (level,)
                    ).fetchall()]
                if not rows:
                    raise HTTPException(status_code=400, detail="no words for level")
            elif body.mode == "jees_sample":
                # 官方样题模式: 从 sample_questions 取题 (前端直接渲染, 不走词汇出题逻辑)
                sq = [dict(r) for r in conn.execute(
                    "SELECT * FROM sample_questions WHERE level=? ORDER BY RANDOM() LIMIT ?",
                    (level, body.count),
                ).fetchall()]
                if not sq:
                    raise HTTPException(status_code=400, detail="no sample questions for level")
                questions = []
                for s in sq:
                    qid = uuid.uuid4().hex
                    opts = json.loads(s["options"])
                    QUIZ_STORE[(user["id"], qid)] = {
                        "word_id": None, "type": "sample",
                        "expected": opts[s["answer"]], "sample_id": s["id"],
                    }
                    questions.append({
                        "qid": qid, "type": "sample", "word_id": None,
                        "prompt": {"stem": s["stem"], "section": s["section"]},
                        "options": opts, "source": "jees-sample",
                    })
                return {"questions": questions, "mode": "jees_sample"}
            else:
                rows = [dict(r) for r in conn.execute(
                    "SELECT * FROM words WHERE level=?", (level,)
                ).fetchall()]
                if not rows:
                    raise HTTPException(status_code=400, detail="no words for level")
    finally:
        conn.close()
    if body.mode == "exam_freq" and rows:
        weights = {"high": 4.0, "mid": 2.0, "low": 1.0}
        wts = [weights.get(r.get("exam_freq"), 0.5) for r in rows]
        n = min(body.count, len(rows))
        # 加权不放回抽样
        sample = []
        pool = rows[:]
        pool_w = wts[:]
        for _ in range(n):
            total = sum(pool_w)
            r = random.random() * total
            acc = 0
            for i, wt in enumerate(pool_w):
                acc += wt
                if r <= acc:
                    sample.append(pool.pop(i))
                    pool_w.pop(i)
                    break
    else:
        sample = random.sample(rows, min(body.count, len(rows)))
    questions = []
    for idx, w in enumerate(sample):
        t = QUIZ_TYPES[idx % len(QUIZ_TYPES)]
        qid = uuid.uuid4().hex
        wd = word_display(w)
        dm, _fb = display_meaning(w, lang)
        if t == "choice_ja":
            prompt = {"word": wd}
            expected = dm
            distract = _distinct_samples(rows, dm, lambda x: display_meaning(x, lang)[0], 3)
            options = [expected] + distract
            random.shuffle(options)
        elif t == "choice_zh":
            prompt = {"meaning": dm}
            expected = wd
            distract = _distinct_samples(rows, wd, word_display, 3)
            options = [expected] + distract
            random.shuffle(options)
        elif t == "listening":
            # v0.3 听音选义: 只给发音 kana, 4 个中文释义选项 (不打字)
            prompt = {"kana": w["kana"]}
            expected = dm
            distract = _distinct_samples(rows, dm, lambda x: display_meaning(x, lang)[0], 3)
            options = [expected] + distract
            random.shuffle(options)
        QUIZ_STORE[(user["id"], qid)] = {"word_id": w["id"], "type": t, "expected": expected}
        q = {"qid": qid, "type": t, "word_id": w["id"], "prompt": prompt}
        if options is not None:
            q["options"] = options
        questions.append(q)
    return {"questions": questions}


@app.post("/api/quiz/submit")
def quiz_submit(body: QuizSubmitIn, user: dict = Depends(current_user)):
    score = 0
    wrong_ids = []
    details = []
    lang = user.get("lang") or "zh"
    conn = get_db()
    try:
        with _write_lock:
            for item in body.qid_answers:
                key = (user["id"], item.qid)
                entry = QUIZ_STORE.pop(key, None)
                if entry is None:
                    details.append({"qid": item.qid, "correct": False, "expected": None})
                    continue
                expected = entry["expected"]
                ans = item.answer or ""
                correct = ans == str(expected)
                details.append({"qid": item.qid, "correct": correct, "expected": expected})
                if correct:
                    score += 1
                else:
                    wrong_ids.append(entry["word_id"])
                    # 错词加入复习队列: 不存在则建默认行, due_at 置为 now
                    conn.execute(
                        """INSERT INTO user_words
                           (user_id, word_id, easiness, interval, repetitions, due_at, updated_at)
                           VALUES (?,?,2.5,0,0,?,?)
                           ON CONFLICT(user_id, word_id) DO UPDATE SET
                             due_at=excluded.due_at, updated_at=excluded.updated_at""",
                        (user["id"], entry["word_id"], now_iso(), now_iso()),
                    )
            conn.commit()
    finally:
        conn.close()
    # 错题详情（单词/假名/释义），供成绩单展示
    wrong = []
    if wrong_ids:
        conn2 = get_db()
        try:
            placeholders = ",".join("?" for _ in wrong_ids)
            for r in conn2.execute(
                f"SELECT * FROM words WHERE id IN ({placeholders})", wrong_ids
            ).fetchall():
                w = dict(r)
                dm, _fb = display_meaning(w, lang)
                wrong.append({
                    "word_id": w["id"],
                    "word": word_display(w),
                    "kana": w["kana"],
                    "meaning": dm,
                })
        finally:
            conn2.close()
    return {"score": score, "total": len(body.qid_answers), "wrong": wrong, "details": details}


# ---------------- 打卡与统计 ----------------

def compute_streak(conn: sqlite3.Connection, user_id: int) -> int:
    rows = conn.execute("SELECT date FROM checkins WHERE user_id=?", (user_id,)).fetchall()
    dates = {r["date"] for r in rows}
    cur = today_str()
    if cur not in dates:
        cur = (now_dt() - timedelta(days=1)).strftime("%Y-%m-%d")
    streak = 0
    while cur in dates:
        streak += 1
        cur = (datetime.strptime(cur, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    return streak


@app.post("/api/checkin")
def checkin(user: dict = Depends(current_user)):
    conn = get_db()
    try:
        with _write_lock:
            conn.execute(
                "INSERT OR IGNORE INTO checkins (user_id, date) VALUES (?,?)",
                (user["id"], today_str()),
            )
            conn.commit()
        return {"checked": True, "streak": compute_streak(conn, user["id"])}
    finally:
        conn.close()


@app.get("/api/home/summary")
def home_summary(user: dict = Depends(current_user)):
    conn = get_db()
    try:
        today = today_str()
        today_learned = conn.execute(
            "SELECT COUNT(DISTINCT word_id) AS c FROM study_logs"
            " WHERE user_id=? AND substr(created_at,1,10)=?",
            (user["id"], today),
        ).fetchone()["c"]
        review_due = conn.execute(
            "SELECT COUNT(*) AS c FROM user_words WHERE user_id=? AND due_at <= ?",
            (user["id"], now_iso()),
        ).fetchone()["c"]
        checked_in_today = (
            conn.execute(
                "SELECT 1 FROM checkins WHERE user_id=? AND date=?", (user["id"], today)
            ).fetchone()
            is not None
        )
        return {
            "today_learned": today_learned,
            "daily_goal": user.get("daily_goal") or 30,
            "review_due": review_due,
            "streak": compute_streak(conn, user["id"]),
            "checked_in_today": checked_in_today,
        }
    finally:
        conn.close()


# ---------------- 岛屿养成 ----------------

ISLAND_LEVELS = [
    {"level": 1, "name": "沙洲", "streak": 0, "words": 0},
    {"level": 2, "name": "小岛", "streak": 3, "words": 50},
    {"level": 3, "name": "绿岛", "streak": 7, "words": 150},
    {"level": 4, "name": "樱花岛", "streak": 14, "words": 300},
    {"level": 5, "name": "日语之岛", "streak": 30, "words": 600},
]


@app.get("/api/island")
def island(user: dict = Depends(current_user)):
    """岛屿养成: 等级由连续打卡天数 / 累计学词数双维度决定 (任一达标即升级)。"""
    conn = get_db()
    try:
        streak = compute_streak(conn, user["id"])
        total_words = conn.execute(
            "SELECT COUNT(DISTINCT word_id) AS c FROM user_words WHERE user_id=?",
            (user["id"],),
        ).fetchone()["c"]
        level = 1
        for lv in ISLAND_LEVELS:
            if streak >= lv["streak"] or total_words >= lv["words"]:
                level = lv["level"]
        cur = ISLAND_LEVELS[level - 1]
        if level >= len(ISLAND_LEVELS):
            nxt, progress, is_max = None, 1.0, True
        else:
            nxt = ISLAND_LEVELS[level]
            progress = max(
                min(streak / nxt["streak"], 1.0) if nxt["streak"] else 0.0,
                min(total_words / nxt["words"], 1.0) if nxt["words"] else 0.0,
            )
            is_max = False
        return {
            "level": level, "level_name": cur["name"],
            "streak": streak, "total_words": total_words,
            "is_max": is_max, "progress": round(progress, 2),
            "next_level": nxt["level"] if nxt else None,
            "next_level_name": nxt["name"] if nxt else None,
            "next_streak": nxt["streak"] if nxt else None,
            "next_words": nxt["words"] if nxt else None,
        }
    finally:
        conn.close()


@app.get("/api/stats/overview")
def stats_overview(user: dict = Depends(current_user)):
    conn = get_db()
    try:
        total_studied = conn.execute(
            "SELECT COUNT(*) c FROM user_words WHERE user_id=?", (user["id"],)
        ).fetchone()["c"]
        mastered = conn.execute(
            "SELECT COUNT(*) c FROM user_words WHERE user_id=? AND (repetitions>=5 OR interval>=30)",
            (user["id"],),
        ).fetchone()["c"]
        wbl_rows = conn.execute(
            """SELECT w.level AS level, COUNT(*) AS c FROM user_words uw
               JOIN words w ON w.id=uw.word_id
               WHERE uw.user_id=? GROUP BY w.level""",
            (user["id"],),
        ).fetchall()
        words_by_level = {r["level"]: r["c"] for r in wbl_rows}
        week_activity = []
        for i in range(6, -1, -1):
            d = (now_dt() - timedelta(days=i)).strftime("%Y-%m-%d")
            c = conn.execute(
                "SELECT COUNT(*) c FROM study_logs WHERE user_id=? AND substr(created_at,1,10)=?",
                (user["id"], d),
            ).fetchone()["c"]
            week_activity.append(c)
        since = (now_dt() - timedelta(days=59)).strftime("%Y-%m-%d")
        cal_rows = conn.execute(
            "SELECT date FROM checkins WHERE user_id=? AND date>=? ORDER BY date",
            (user["id"], since),
        ).fetchall()
        return {
            "streak_days": compute_streak(conn, user["id"]),
            "total_studied": total_studied,
            "mastered_count": mastered,
            "words_by_level": words_by_level,
            "week_activity": week_activity,
            "checkin_calendar": [r["date"] for r in cal_rows],
        }
    finally:
        conn.close()


# ---------------- 前端静态托管 (最后挂载) ----------------

def _find_frontend_dir() -> Path | None:
    candidates = [
        Path("/app/frontend"),
        Path(__file__).resolve().parent.parent.parent / "frontend",
    ]
    for c in candidates:
        if c.is_dir():
            return c
    return None


_frontend_dir = _find_frontend_dir()

# sw.js 必须禁用 HTTP 缓存，否则浏览器数小时内拿不到新 SW，热更新失效
# （注意：必须在 StaticFiles mount 之前定义，路由按顺序匹配）
if _frontend_dir is not None:
    from fastapi.responses import FileResponse

    @app.get("/sw.js", include_in_schema=False)
    def _sw_no_cache():
        return FileResponse(
            str(_frontend_dir / "sw.js"),
            media_type="application/javascript",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

if _frontend_dir is not None:
    app.mount("/", StaticFiles(directory=str(_frontend_dir), html=True), name="frontend")
