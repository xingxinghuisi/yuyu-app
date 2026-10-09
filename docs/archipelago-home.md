# 群岛地图首页 · 第一版

> 本文件记录上一版 SVG 方案与当时验证环境。当前首页已升级为独立动漫素材分层，最新实现、HTTP/PWA 验证与差距见 [动漫首页说明](anime-home.md)。

## 审计

基线：`7651b4c17e70c0224dde259006a478e1f05fd041`。前端为无构建的 `index.html / styles.css / app.js`，hash 路由，登录 token 位于 localStorage；FastAPI 同源托管前端、SQLite 存词库和用户状态。书架通过 `StudyCtx → /study/plan → /study/answer` 学习，FSRS 经 `/review/due /review/answer` 复习。首页原先由任务卡、打卡和养成小岛组成。没有独立课程章节、旅人坐标或 XP 数据表。

## 实现与数据约定

- 首页改为原生 SVG 分层群岛，HTML 标签、节点、旅人和学习卡片覆盖其上，坐标与 SVG 共用同一比例。原创素材，无整图背景，无外部图片、字体、CDN 或新增生产依赖。
- `/books` 的 `level-n5 … level-n1` 提供真实 `studied / total`。地图每 30 词派生一航段，末段可不足 30 词；航段是词书进度里程碑，不是新的教学章节，也不是掌握率。没有伪造课程名、分钟或 XP。
- 前一词书全部已学后解锁下一岛。已经学过高阶词书的用户保留该岛入口；书架始终允许自由选级，地图不修改后台权限或已有学习逻辑。
- 继续学习通过新 hash 路由 `#/voyage` 设定现有 `StudyCtx` 后调用原有 `startStudyFlow()`。刷新该路由回书架。完成岛进入原有 FSRS 复习（全局到期词，不限定岛屿）。原有考试、生词本、统计、设置、养成、打卡海报继续可用。
- `/home/summary` 提供今日已学、目标、连续打卡和待复习。`/island` 仍为原有养成等级，与 JLPT 岛屿分开显示。
- 必需数据加载失败显示重试；可选养成/收藏接口失败不伪造统计；路由离开后首页请求结果不覆盖新页面。
- PWA 缓存版本升级，预缓存三个新脚本/样式，API 请求明确跳过 Service Worker 缓存。
- 补齐原仓库 manifest 引用但缺失的 192/512px 安装图标，附原创 SVG 源文件。

## 性能和可访问性

SVG symbol 复用树木/建筑，场景无需 Canvas 循环、WebGL 或图片解码。微动画使用 CSS；页面隐藏时暂停。静谧模式持久化，系统减少动态、Save-Data、≤4 线程设备自动降级并移除背景模糊。所有关键入口为原生按钮/链接，支持键盘、可见焦点、状态名称；详情可聚焦，导航保留学习、复习、我的及考试入口。允许浏览器缩放。移动端单列，桌面双列；窄屏保持纵向地图，所有岛可滚动访问。

## 本地启动

```sh
python -m pip install -r backend/requirements.txt tzdata
# 配置 DATA_DIR 为仓库内 ./data、JWT_SECRET 为本地开发随机值
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

打开 `http://127.0.0.1:8000/#/home`，使用本地账号注册/登录。线上仍使用原来的 Docker 部署方式。无需数据库迁移或前端构建。

## 与参考图的差距

本版是精细分层矢量插画，尚未达到参考图的动漫绘景、复杂建筑光影、镜头透视与海浪细节。旅人为原创简化 SVG，微动画为轻微起伏，未实现逐帧行走或乘船跨岛。参考图中“第 3 课 / はじめまして / XP / 分钟目标”缺少现有数据支持，采用真实词数与航段替代。更丰富的课程需要独立课程数据与可复习的章节 API；进一步接近原画可替换单座岛的美术层，保留现有控制层与坐标模型。

GitHub 远程写入未执行；本地分支 `feat/archipelago-home` 可供审阅后推送。

## 验证结果

- `node --test tests/map-model.test.cjs tests/map-sw.test.cjs`：进度/解锁边界与 SW 缓存行为。
- 原有 `smoke_test.py` 全部通过，使用 `tests/api-bridge.py --smoke` 将请求交给真实 FastAPI TestClient 和独立 SQLite 测试库。顺带修正 `seed_db.py` 的 Windows 只读 ATTACH URI，Linux 路径同样适用。
- `tests/map-browser.cjs --in-process`：Chrome 实际渲染，API 经进程内传输到真实后端，验证学习一词后回首页词数持久化、打卡海报、减少动态设置、320/390/768/1440px 布局、原有路由、失败重试、首页请求竞态与运行错误。
- 截图位于 `data/map-preview/mobile.png` 与 `desktop.png`，来自测试账号的真实后端数据；非设计稿。
- 本环境跨命令会话的 localhost 不通，后台联动启动命令被自动审批拒绝。浏览器测试使用无端口 ASGI 传输；真实 HTTP 下 SW 注册、安装/离线重载与真机 Safari 性能仍需部署环境验证。新增测试传输依赖 `httpx`，不加入生产依赖。
- 工作区出现另一处编辑的插画版，按用户选择恢复分层 SVG 版；另一版备份位于 `data/alternate-map/`，未纳入本次变更。
