# v1.3.3 · 学习数量设置

在「我的 → 学习设置」直接输入两个数值，再点击「保存设置」：

- **每次学习词数**：每次开始学习时加载的新词数量，默认 30，可设置为 1–200 的整数。剩余新词不足时返回实际数量。
- **每日学习目标**：首页今日进度使用的目标，支持直接输入 1–200 的整数，与每次学习词数分别保存。

设置保存在账号中，刷新或重新登录后仍然有效。每次学习词数从下次开始学习时生效。读取及保存期间输入框暂时禁用，保存失败时保留输入内容以便重试。

## 实现与升级

`PUT /api/auth/profile` 接受 `study_batch_size`；`GET /api/auth/me` 返回该设置。`POST /api/study/plan` 的词书、等级、顺序与随机入口均使用账号保存的数量。

应用启动时为旧数据库补充 `users.study_batch_size`，默认 30。重复启动会保留已设置的数量和已有每日目标、学习记录。

前端版本为 `1.3.3`，PWA 缓存为 `yuyu-v28-study-settings`。部署时需要同时更新前后端并重建容器。

## 验证

- `python -m unittest discover -s tests -p test_study_settings.py -v`：4 项通过，覆盖旧数据库升级、用户设置隔离、各学习入口、边界值、剩余新词不足与非法输入。
- `node tests/study-settings-browser.cjs`：390px 手机与 1280px 桌面通过直接输入、保存、刷新回显、失败重试及实际 65 词学习流程。
- `node --test tests/map-sw.test.cjs`：4 项 PWA 缓存检查通过。

浏览器测试需安装 Playwright、Chrome，以及后端依赖和 httpx；使用项目已有的 `tests/api-bridge.py` 测试数据库，不连接线上账号。
