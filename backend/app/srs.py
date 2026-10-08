"""FSRS 记忆调度 (基于开源 py-fsrs, MIT License)。

v0.3 起替代 SM-2。核心概念 (FSRS-6):
- 每张卡维护 stability(稳定度/天)、difficulty(难度 1-10)、state、step、due。
- 调度全部委托给 fsrs.Scheduler (默认参数, 期望记忆保持率 0.9)。

自评 grade(0-5) → FSRS Rating 映射 (v0.3 新词三档自评):
    认识 (grade 5)            → Rating.Easy   # 毫不费力想起, 直接毕业
    偏易 (grade 4, 预留兼容)   → Rating.Good
    模糊 (grade 3)            → Rating.Hard   # 想起但费力
    不认识/忘记/答错 (grade 0-2) → Rating.Again

老数据迁移见 seed_db._migrate_fsrs_columns:
    difficulty = clamp(5.0 + (2.5 - easiness) * 3.0, 1, 10)  # SM-2 easiness 越高越简单
    stability  = max(interval, 1) (repetitions>0 的老卡), 否则 None 由 FSRS 首评初始化
"""

from datetime import datetime, timezone

from fsrs import Card, Rating, Scheduler, State

_SCHEDULER = Scheduler()  # FSRS-6 默认参数

# 本地状态枚举与 fsrs.State 对齐: Learning=1, Review=2, Relearning=3
STATE_LEARNING = State.Learning.value
STATE_REVIEW = State.Review.value
STATE_RELEARNING = State.Relearning.value


def grade_to_rating(grade: int) -> Rating:
    """0-5 自评 → FSRS 四档 (映射关系见模块 docstring)。"""
    if grade >= 5:
        return Rating.Easy
    if grade == 4:
        return Rating.Good
    if grade == 3:
        return Rating.Hard
    return Rating.Again


def blank_fsrs() -> dict:
    """新词的 FSRS 初始状态: 交给算法在首次复习时按 rating 初始化。"""
    return {
        "stability": None,
        "difficulty": None,
        "state": STATE_LEARNING,
        "step": 0,
        "last_review": None,  # ISO 字符串或 None
    }


def _parse_dt(s):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _to_card(fs: dict, now_utc: datetime) -> Card:
    card = Card()
    card.stability = fs.get("stability")
    card.difficulty = fs.get("difficulty")
    try:
        card.state = State(fs.get("state") or STATE_LEARNING)
    except ValueError:
        card.state = State.Learning
    card.step = fs.get("step") or 0
    card.last_review = _parse_dt(fs.get("last_review"))
    card.due = now_utc  # 调度基准为"现在"; FSRS 按 rating 推算下次 due
    return card


def review_fsrs(grade: int, fs: dict | None, now: datetime) -> dict:
    """执行一次 FSRS 复习。

    fs: {stability, difficulty, state, step, last_review} (缺失/None 视为新卡)
    now: 本地 datetime (Asia/Shanghai, main.py 的 now_dt())
    返回: {stability, difficulty, state, step, last_review(UTC ISO),
           due(UTC datetime), interval_days, rating(1-4)}
    """
    fs = fs or blank_fsrs()
    now_utc = now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    rating = grade_to_rating(grade)
    card = _to_card(fs, now_utc)
    new_card, _log = _SCHEDULER.review_card(card, rating)
    due_utc = new_card.due
    interval_days = max(0, round((due_utc - now_utc).total_seconds() / 86400))
    last_review = new_card.last_review or now_utc
    return {
        "stability": new_card.stability,
        "difficulty": new_card.difficulty,
        "state": new_card.state.value,
        "step": new_card.step or 0,
        "last_review": last_review.astimezone(timezone.utc).isoformat(),
        "due": due_utc,
        "interval_days": interval_days,
        "rating": rating.value,
    }


def difficulty_from_easiness(easiness: float | None) -> float:
    """SM-2 老数据迁移: easiness(默认 2.5, 越高越简单) → FSRS difficulty(1-10)。"""
    e = 2.5 if easiness is None else float(easiness)
    return max(1.0, min(10.0, 5.0 + (2.5 - e) * 3.0))
