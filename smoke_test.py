#!/usr/bin/env python3
"""语屿 Kotoba 后端全链路冒烟测试 (仅标准库 urllib)。

用法: python3 smoke_test.py [base_url]   # 默认 http://127.0.0.1:8000
"""

import json
import random
import string
import sys
import urllib.error
import urllib.request
from datetime import datetime

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
fails = 0


def api(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8") or "null"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") or "null"
        try:
            payload = json.loads(raw)
        except Exception:
            payload = raw
        return e.code, payload


def step(name, cond, extra=""):
    global fails
    if cond:
        print(f"PASS {name}")
    else:
        fails += 1
        print(f"FAIL {name} {extra}")


def word_display(w):
    return w["kanji"] if w["kanji"] else w["kana"]


def expected_for(q, w):
    t = q["type"]
    if t == "choice_ja":
        return w["display_meaning"]
    if t == "choice_zh":
        return word_display(w)
    if t == "listening":  # v0.3 听音选义：4 个中文选项
        return w["display_meaning"]
    raise AssertionError("unknown type " + t)


def main():
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    username = f"smoke_{suffix}"
    password = "Abc12345"

    # 1. register
    s, r = api("POST", "/api/auth/register", {"username": username, "password": password})
    step("register 201", s == 201 and r.get("username") == username, f"{s} {r}")
    user_id = r.get("id")

    # 1b. duplicate register -> 409
    s, r = api("POST", "/api/auth/register", {"username": username, "password": password})
    step("register duplicate 409", s == 409, f"{s} {r}")

    # 1c. bad register -> 400
    s, r = api("POST", "/api/auth/register", {"username": "ab", "password": "123"})
    step("register invalid 400", s == 400, f"{s} {r}")

    # 2. login
    s, r = api("POST", "/api/auth/login", {"username": username, "password": password})
    step("login 200", s == 200 and r.get("token"), f"{s} {r}")
    token = r.get("token")

    # 2b. wrong password -> 401
    s, r = api("POST", "/api/auth/login", {"username": username, "password": "Wrong1234"})
    step("login wrong 401", s == 401 and r.get("detail") == "unauthorized", f"{s} {r}")

    # 3. me / unauth
    s, r = api("GET", "/api/auth/me", token=token)
    step("me 200", s == 200 and r.get("id") == user_id and r.get("username") == username, f"{s} {r}")
    s, r = api("GET", "/api/auth/me")
    step("me no token 401", s == 401 and r.get("detail") == "unauthorized", f"{s} {r}")

    # 4. study/plan -> {words:[30 N5], daily_goal:30, today_learned}
    s, plan = api("POST", "/api/study/plan", {"level": "N5"}, token=token)
    words = plan.get("words") if isinstance(plan, dict) else None
    step("study/plan shape", s == 200 and isinstance(words, list) and len(words) == 30
         and plan.get("daily_goal") == 30 and plan.get("today_learned") == 0,
         f"{s} {str(plan)[:200]}")
    step("study/plan all N5", all(w.get("level") == "N5" for w in words), "")

    # 4a. study/plan 无 body (前端实际调用方式, 曾 422) -> 200
    s, plan_nb = api("POST", "/api/study/plan", None, token=token)
    step("study/plan no-body 200", s == 200 and len(plan_nb.get("words", [])) == 30, f"{s}")

    # 4b. home/summary before study
    s, hs = api("GET", "/api/home/summary", token=token)
    step("home/summary shape", s == 200 and hs.get("daily_goal") == 30
         and hs.get("today_learned") == 0 and hs.get("checked_in_today") is False
         and isinstance(hs.get("streak"), int) and isinstance(hs.get("review_due"), int),
         f"{s} {hs}")

    # 5. answer all grade=5 (v0.3 FSRS: 认识→Easy, interval ~6-10 天)
    ok = True
    for w in words:
        s, r = api("POST", "/api/study/answer", {"word_id": w["id"], "grade": 5}, token=token)
        if not (s == 200 and r.get("word_id") == w["id"] and r.get("interval", 0) >= 5
                and r.get("rating") == 4 and r.get("stability")):
            ok = False
            print(f"   answer failed for {w['id']}: {s} {r}")
            break
    step("study/answer x30 grade=5 (FSRS Easy)", ok, "")

    # 5b. bad grade -> 422
    s, r = api("POST", "/api/study/answer", {"word_id": words[0]["id"], "grade": 9}, token=token)
    step("study/answer invalid grade 422", s == 422, f"{s} {r}")

    # 5c. plan again -> today_learned should be 30
    s, plan2 = api("POST", "/api/study/plan", {"level": "N5"}, token=token)
    step("study/plan today_learned", s == 200 and plan2.get("today_learned") == 30,
         f"{s} {str(plan2)[:200]}")

    # 5d. home/summary after study
    s, hs2 = api("GET", "/api/home/summary", token=token)
    step("home/summary after study", s == 200 and hs2.get("today_learned") == 30
         and hs2.get("review_due") == 0, f"{s} {hs2}")

    # 6. review/due should be empty (just studied, due tomorrow)
    s, due = api("GET", "/api/review/due?limit=100", token=token)
    step("review/due empty after study", s == 200 and due == [], f"{s} len={len(due) if isinstance(due, list) else '?'}")

    # 6b. review/answer 路由存在且真实写入 (回归: 该路由曾缺失导致复习自评被静默丢弃)
    s, w2 = api("GET", "/api/vocab?level=N5&limit=50&offset=30", token=token)
    fresh_id = w2[0]["id"] if s == 200 and w2 else None
    s, ra = api("POST", "/api/review/answer", {"word_id": fresh_id, "grade": 5}, token=token)
    step("review/answer 200 (FSRS)", s == 200 and ra.get("interval", 0) >= 5
         and ra.get("rating") == 4, f"{s} {ra}")
    s, st0 = api("GET", "/api/stats/overview", token=token)
    step("review/answer persisted", s == 200 and st0.get("total_studied") == 31, f"{s} {st0}")

    # 7. quiz/start count=5, answer all correctly via /api/vocab/{id}
    s, quiz = api("POST", "/api/quiz/start", {"level": "N5", "count": 5}, token=token)
    step("quiz/start 5", s == 200 and len(quiz) == 5, f"{s} {quiz if s != 200 else ''}")
    answers = []
    for q in quiz:
        s, w = api("GET", f"/api/vocab/{q['word_id']}", token=token)
        if s != 200:
            step("quiz correct submit", False, f"vocab fetch {s}")
            return
        answers.append({"qid": q["qid"], "answer": expected_for(q, w)})
    s, res = api("POST", "/api/quiz/submit", {"qid_answers": answers}, token=token)
    step("quiz/submit score==total", s == 200 and res.get("score") == 5 and res.get("total") == 5,
         f"{s} {res}")

    # 8. quiz again, answer all wrong
    s, quiz2 = api("POST", "/api/quiz/start", {"level": "N5", "count": 5}, token=token)
    bad_answers = [{"qid": q["qid"], "answer": "__definitely_wrong__"} for q in quiz2]
    s, res2 = api("POST", "/api/quiz/submit", {"qid_answers": bad_answers}, token=token)
    step("quiz/submit wrong score==0", s == 200 and res2.get("score") == 0, f"{s} {res2}")
    step("quiz/submit wrong non-empty", s == 200 and len(res2.get("wrong", [])) == 5,
         f"{s} {res2}")
    wrong_ids = set(res2.get("wrong", []))

    # 9. wrong words should be in review queue
    s, due2 = api("GET", "/api/review/due?limit=100", token=token)
    due_ids = {w["id"] for w in due2} if s == 200 else set()
    step("review/due contains wrong words", s == 200 and wrong_ids.issubset(due_ids),
         f"{s} wrong={wrong_ids} due={due_ids}")

    # 10. checkin twice (idempotent)
    s, c1 = api("POST", "/api/checkin", {}, token=token)
    step("checkin 1", s == 200 and c1.get("checked") is True, f"{s} {c1}")
    s, c2 = api("POST", "/api/checkin", {}, token=token)
    step("checkin 2 idempotent", s == 200 and c2.get("checked") is True
         and c2.get("streak") == c1.get("streak"), f"{s} {c2}")

    # 10b. home/summary after checkin
    s, hs3 = api("GET", "/api/home/summary", token=token)
    step("home/summary checked_in", s == 200 and hs3.get("checked_in_today") is True
         and hs3.get("streak", 0) >= 1, f"{s} {hs3}")

    # 11. stats/overview
    s, st = api("GET", "/api/stats/overview", token=token)
    step("stats/overview 200", s == 200, f"{s} {st}")
    if s == 200:
        step("stats streak_days>=1", st.get("streak_days", 0) >= 1, f"{st}")
        step("stats total_studied>=30", st.get("total_studied", 0) >= 30, f"{st}")
        step("stats week_activity len 7", len(st.get("week_activity", [])) == 7, f"{st}")
        step("stats checkin_calendar non-empty", len(st.get("checkin_calendar", [])) >= 1, f"{st}")

    # ==== v0.2 ====

    # 13. lang: 默认 zh, 切换 en, 非法值 400
    s, me0 = api("GET", "/api/auth/me", token=token)
    step("me lang default zh", s == 200 and me0.get("lang") == "zh", f"{s} {me0}")
    s, me_en = api("PUT", "/api/auth/profile", {"lang": "en"}, token=token)
    step("profile lang=en", s == 200 and me_en.get("lang") == "en", f"{s} {me_en}")
    s, bad = api("PUT", "/api/auth/profile", {"lang": "fr"}, token=token)
    step("profile lang invalid 400", s == 400, f"{s} {bad}")

    # 14. zh display: 机翻中文非空 + zh_source='mt', 无回退标记
    s, wzh = api("GET", "/api/vocab?level=N5&limit=1", token=token)
    wz = wzh[0]
    step("zh meaning_zh mt", s == 200 and bool(wz.get("meaning_zh"))
         and wz.get("zh_source") == "mt" and wz.get("meaning_is_en_fallback") is False,
         f"{s} {str(wz)[:200]}")
    exs = wz.get("examples") or []
    step("zh example display_sentence", all(e.get("display_sentence") for e in exs),
         f"{len(exs)} examples")
    # 14b. 例句中英双语: zh 非空 (v0.4.2 机翻打底), en/zh 双字段返回
    step("example zh non-empty", len(exs) > 0 and all(e.get("zh") for e in exs),
         f"{len(exs)} examples, zh empty: {sum(1 for e in exs if not e.get('zh'))}")
    step("example en+zh fields", all("en" in e and "zh" in e for e in exs),
         f"{len(exs)} examples")

    # 15. en display: 显示英文, 无回退
    s, wen = api("GET", "/api/vocab?level=N5&limit=1&lang=en", token=token)
    we = wen[0]
    step("en display_meaning=en", s == 200 and we.get("display_meaning") == we.get("meaning_en")
         and we.get("meaning_is_en_fallback") is False, f"{s} {str(we)[:200]}")

    # 16. 切回 zh
    s, me_zh = api("PUT", "/api/auth/profile", {"lang": "zh"}, token=token)
    step("profile lang=zh", s == 200 and me_zh.get("lang") == "zh", f"{s} {me_zh}")

    # 17. books (v0.4 新结构): 13 本, category 分组, 每本 id/name/total/progress
    s, books = api("GET", "/api/books", token=token)
    step("books 13", s == 200 and len(books) == 13, f"{s} {len(books) if s == 200 else books}")
    cats = {}
    for b in books:
        cats.setdefault(b["category"], []).append(b["id"])
    step("books categories", s == 200
         and cats.get("level") == ["level-n5", "level-n4", "level-n3", "level-n2", "level-n1"]
         and len(cats.get("freq", [])) == 5 and len(cats.get("scene", [])) == 3,
         f"{s} {list(cats) if s == 200 else ''}")
    step("books fields", s == 200 and all(
        all(k in b for k in ("id", "name", "category", "total", "studied", "progress"))
        for b in books), "")
    n5b = next(b for b in books if b["id"] == "level-n5") if s == 200 else {}
    step("books N5 total/progress", n5b.get("total") == 674 and 0 <= n5b.get("progress", -1) <= 1
         and n5b.get("studied", 0) >= 30, f"{n5b}")
    fn5 = next(b for b in books if b["id"] == "freq-n5") if s == 200 else {}
    step("books freq-n5 total=500", fn5.get("total") == 500, f"{fn5}")

    # 17b. N4-N1 中文回填 (回归: v0.4.1 _backfill_zh; 老库升级后 N4 应有中文)
    s, vn4 = api("GET", "/api/vocab?level=N4&limit=5", token=token)
    step("N4 vocab zh backfilled", s == 200 and len(vn4) == 5
         and all(w.get("meaning_zh") for w in vn4)
         and all(w.get("zh_source") == "mt" for w in vn4), f"{s}")

    # 18. plan shuffle: 30 词, 顺序与 seq 不同但集合相同
    s, pseq = api("POST", "/api/study/plan", {"level": "N4", "order": "seq"}, token=token)
    s, pshu = api("POST", "/api/study/plan", {"level": "N4", "order": "shuffle"}, token=token)
    seq_ids = [w["id"] for w in pseq["words"]]
    shu_ids = [w["id"] for w in pshu["words"]]
    step("plan shuffle 30", s == 200 and len(shu_ids) == 30
         and all(w["level"] == "N4" for w in pshu["words"]), f"{s}")
    step("plan shuffle order differs", shu_ids != seq_ids, "identical to seq order")
    s, pinv = api("POST", "/api/study/plan", {"level": "N5", "order": "bogus"}, token=token)
    step("plan invalid order 400", s == 400, f"{s} {pinv}")

    # 19. 斩词 grade=5 → FSRS Easy, 长间隔
    s, vnew = api("GET", "/api/vocab?level=N3&limit=1&offset=100", token=token)
    zw = vnew[0]["id"]
    s, zr = api("POST", "/api/study/answer", {"word_id": zw, "grade": 5}, token=token)
    step("zhan grade=5 FSRS Easy", s == 200 and zr.get("interval", 0) >= 5
         and zr.get("rating") == 4, f"{s} {zr}")

    # 20. quiz word_ids 小测范围限定
    s, v3 = api("GET", "/api/vocab?level=N5&limit=3&offset=200", token=token)
    ids3 = [w["id"] for w in v3]
    s, qz = api("POST", "/api/quiz/start", {"word_ids": ids3, "count": 5}, token=token)
    step("quiz word_ids scoped", s == 200 and len(qz) == 3
         and all(q["word_id"] in ids3 for q in qz), f"{s} {len(qz) if s == 200 else qz}")
    s, qz_empty = api("POST", "/api/quiz/start", {"word_ids": []}, token=token)
    step("quiz word_ids empty 400", s == 400, f"{s} {qz_empty}")

    # 11c. vocab lang 解析: profile lang 生效 / ?lang= 可覆盖 / 匿名默认 zh
    # (回归: 公开 vocab 接口曾无视用户语言设置)
    s, _ = api("PUT", "/api/auth/profile", {"lang": "en"}, token=token)
    s, w_en = api("GET", "/api/vocab?level=N5&limit=1", token=token)
    step("vocab lang from profile", s == 200 and w_en[0]["display_meaning"] == w_en[0]["meaning_en"],
         f"{s} {w_en[0] if s == 200 else w_en}")
    s, w_ov = api("GET", "/api/vocab?level=N5&limit=1&lang=zh", token=token)
    step("vocab ?lang= overrides profile", s == 200 and w_ov[0]["display_meaning"] == w_ov[0]["meaning_zh"]
         and w_ov[0]["meaning_zh"], f"{s}")
    s, w_an = api("GET", "/api/vocab?level=N5&limit=1")
    step("vocab anonymous defaults zh", s == 200 and w_an[0]["display_meaning"] == w_an[0]["meaning_zh"],
         f"{s}")
    s, _ = api("PUT", "/api/auth/profile", {"lang": "zh"}, token=token)
    step("profile lang back to zh", s == 200, f"{s}")

    # ==== v0.3 ====

    # 21. 无打字题型: quiz/start 多题中不应出现 spelling, 且 listening 为听音选义
    s, qbig = api("POST", "/api/quiz/start", {"level": "N5", "count": 20}, token=token)
    types = {q["type"] for q in qbig} if s == 200 else set()
    step("quiz no spelling type", s == 200 and "spelling" not in types
         and types <= {"choice_ja", "choice_zh", "listening"}, f"{s} {types}")
    lqs = [q for q in qbig if q["type"] == "listening"] if s == 200 else []
    step("quiz listening has questions", len(lqs) > 0, f"{len(lqs)}")
    lok = True
    for q in lqs:
        # prompt 只有 kana(无 meaning 泄题), 4 个中文选项
        if set(q["prompt"].keys()) != {"kana"} or len(q.get("options") or []) != 4:
            lok = False
            break
        s, w = api("GET", f"/api/vocab/{q['word_id']}", token=token)
        if s != 200 or w["display_meaning"] not in q["options"]:
            lok = False
            break
    step("listening = 听音选义", lok, "")

    # 22. FSRS 三档映射: 5→Easy(4) 间隔远, 3→Hard(2), 0→Again(1) due 很近
    s, v4 = api("GET", "/api/vocab?level=N4&limit=3&offset=300", token=token)
    w5, w3, w0 = [w["id"] for w in v4]
    s, r5 = api("POST", "/api/study/answer", {"word_id": w5, "grade": 5}, token=token)
    step("fsrs grade5→Easy", s == 200 and r5.get("rating") == 4 and r5.get("interval", 0) >= 5,
         f"{s} {r5}")
    s, r3 = api("POST", "/api/study/answer", {"word_id": w3, "grade": 3}, token=token)
    step("fsrs grade3→Hard", s == 200 and r3.get("rating") == 2 and r3.get("interval") == 0,
         f"{s} {r3}")
    s, r0 = api("POST", "/api/study/answer", {"word_id": w0, "grade": 0}, token=token)
    step("fsrs grade0→Again due 近", s == 200 and r0.get("rating") == 1 and r0.get("interval") == 0
         and r0.get("stability", 0) < 1.0, f"{s} {r0}")
    # 答错 due 近、答对 due 远 (与服务端时间比, 避免时区问题)
    s, hh = api("GET", "/api/health")
    srv_now = hh["time"] if s == 200 else None
    def mins_after(a, b):
        fa = datetime.strptime(a, "%Y-%m-%dT%H:%M:%S")
        fb = datetime.strptime(b, "%Y-%m-%dT%H:%M:%S")
        return (fa - fb).total_seconds() / 60
    step("fsrs Again due 15分钟内", srv_now and 0 <= mins_after(r0["due_at"], srv_now) < 15,
         r0["due_at"])
    step("fsrs Hard due 30分钟内", srv_now and 0 <= mins_after(r3["due_at"], srv_now) < 30,
         r3["due_at"])
    step("fsrs Easy due 4天后", srv_now and mins_after(r5["due_at"], srv_now) > 4 * 24 * 60,
         r5["due_at"])

    # 23. 单词详情: kanji_info / mnemonic_zh 字段存在; 会う 的 kanji_info 非空
    s, wau = api("GET", "/api/vocab?level=N5&limit=50", token=token)
    au = next((w for w in wau if w["kana"] == "あう"), None) if s == 200 else None
    step("detail au found", au is not None, "")
    if au:
        s, det = api("GET", f"/api/vocab/{au['id']}", token=token)
        ki = det.get("kanji_info") if s == 200 else None
        step("detail kanji_info", s == 200 and isinstance(ki, list) and len(ki) > 0
             and ki[0].get("character") == "会" and ki[0].get("strokes") == 6,
             f"{s} {str(det)[:300] if s == 200 else det}")
        step("detail mnemonic_zh key", s == 200 and "mnemonic_zh" in det, "")
        exs = det.get("examples") if s == 200 else []
        step("detail examples have ja", s == 200 and len(exs) > 0
             and all(e.get("ja") for e in exs), f"{len(exs) if isinstance(exs, list) else '?'}")

    # ==== v0.4 ====

    # 24. study/plan book_id: 高频书/场景书出词; 非法 book_id 400
    s, pb = api("POST", "/api/study/plan", {"book_id": "freq-n5", "order": "seq"}, token=token)
    step("plan book_id freq-n5", s == 200 and len(pb.get("words", [])) > 0
         and all(w["level"] == "N5" for w in pb["words"]), f"{s}")
    s, ps = api("POST", "/api/study/plan", {"book_id": "scene-travel"}, token=token)
    step("plan book_id scene-travel", s == 200 and len(ps.get("words", [])) > 0, f"{s}")
    s, pbad = api("POST", "/api/study/plan", {"book_id": "no-such-book"}, token=token)
    step("plan invalid book_id 400", s == 400, f"{s} {pbad}")
    # book_id + shuffle 仍可用
    s, pbsh = api("POST", "/api/study/plan", {"book_id": "freq-n4", "order": "shuffle"}, token=token)
    step("plan book_id shuffle", s == 200 and len(pbsh.get("words", [])) > 0, f"{s}")

    # 25. island: 形状与等级规则
    s, isl = api("GET", "/api/island", token=token)
    step("island shape", s == 200 and isl.get("level") in (1, 2, 3, 4, 5)
         and isinstance(isl.get("level_name"), str) and isinstance(isl.get("streak"), int)
         and isinstance(isl.get("total_words"), int) and 0 <= isl.get("progress", -1) <= 1,
         f"{s} {isl}")
    # 该用户学了 30+ 词且打卡 1 天: total_words>=31, streak>=1
    step("island values", s == 200 and isl.get("total_words", 0) >= 31
         and isl.get("streak", 0) >= 1, f"{isl if s == 200 else ''}")

    # 26. v0.4.3 每日学习目标
    s, me0 = api("GET", "/api/auth/me", token=token)
    step("me has daily_goal default 30", s == 200 and me0.get("daily_goal") == 30, f"{s} {me0.get('daily_goal')}")
    s, _ = api("PUT", "/api/auth/profile", {"daily_goal": 50}, token=token)
    step("profile set daily_goal 50", s == 200, f"{s}")
    s, me1 = api("GET", "/api/auth/me", token=token)
    step("me daily_goal is 50", s == 200 and me1.get("daily_goal") == 50, f"{me1.get('daily_goal')}")
    s, summ = api("GET", "/api/home/summary", token=token)
    step("summary daily_goal is 50", s == 200 and summ.get("daily_goal") == 50, f"{summ.get('daily_goal')}")
    s, pl = api("POST", "/api/study/plan", {"level": "N5", "order": "seq"}, token=token)
    step("plan daily_goal is 50", s == 200 and pl.get("daily_goal") == 50, f"{pl.get('daily_goal')}")
    for bad in (0, -5, 201, 1000):
        s, _ = api("PUT", "/api/auth/profile", {"daily_goal": bad}, token=token)
        step(f"profile daily_goal {bad} 400", s == 400, f"{s}")
    s, _ = api("PUT", "/api/auth/profile", {"daily_goal": 30}, token=token)
    step("profile daily_goal back to 30", s == 200, f"{s}")

    # 27. v0.4.3 新学习流评分映射：认识=4(Good) / 不认识=1(Again)
    words = pl.get("words", [])
    if len(words) >= 2:
        s, r4 = api("POST", "/api/study/answer", {"word_id": words[0]["id"], "grade": 4}, token=token)
        step("study grade4→Good", s == 200 and r4.get("rating") == 3, f"{s} {r4.get('rating')}")
        s, r1 = api("POST", "/api/study/answer", {"word_id": words[1]["id"], "grade": 1}, token=token)
        step("study grade1→Again", s == 200 and r1.get("rating") == 1, f"{s} {r1.get('rating')}")
    else:
        step("study grade mapping words available", False, "plan words < 2")

    # 12. health
    s, h = api("GET", "/api/health")
    step("health", s == 200 and h.get("ok") is True, f"{s} {h}")

    print()
    if fails:
        print(f"{fails} FAILURES")
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
