"""注册 / 登录 / JWT / bcrypt 校验逻辑。"""

import os
import re
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
ALG = "HS256"
EXP_DAYS = 7

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_DIGITS_RE = re.compile(r"^1[3-9]\d{9}$")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def validate_username(username: str) -> bool:
    return bool(username) and USERNAME_RE.match(username) is not None


def validate_password(password: str) -> bool:
    if not password or len(password) < 8:
        return False
    has_letter = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    return has_letter and has_digit


def validate_email(email: str) -> bool:
    return bool(email) and EMAIL_RE.match(email) is not None


def normalize_phone(raw: str):
    """支持 1[3-9]xxxxxxxxx，可带 +86 / 86 前缀；入库统一为 11 位。
    返回 (ok, normalized_or_None)。
    """
    if raw is None:
        return True, None
    s = str(raw).strip().replace(" ", "").replace("-", "")
    if s.startswith("+86"):
        s = s[3:]
    elif s.startswith("86") and len(s) == 13:
        s = s[2:]
    if not PHONE_DIGITS_RE.match(s):
        return False, None
    return True, s


def create_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=EXP_DAYS)).timestamp()),
    }
    return jwt.encode(payload, SECRET, algorithm=ALG)


def decode_token(token: str):
    """成功返回 user_id(int)，失败返回 None。"""
    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALG])
        return int(payload.get("sub"))
    except Exception:
        return None
