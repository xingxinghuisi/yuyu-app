#!/bin/bash
# 语屿 yuyu-app VPS 每日自动备份
# 备份内容: /data/app.db (用户账号+学习进度, 在线热备份) + .env
# 存放: /www/backup/yuyu-app/yuyu-backup-YYYY-MM-DD.tar.gz, 保留最近 14 天
# 安装 (VPS 上跑一次):
#   crontab -e   ->   加一行:  30 3 * * * /bin/bash /www/wwwroot/yuyu-app/deploy/vps-daily-backup.sh >> /www/backup/yuyu-app/backup.log 2>&1
# 还原: tar -xzf /www/backup/yuyu-app/yuyu-backup-<日期>.tar.gz -C /tmp/restore/
#       然后把 app.db 拷回 /www/wwwroot/yuyu-app/data/, .env 拷回 /www/wwwroot/yuyu-app/
set -euo pipefail

APP_DIR=/www/wwwroot/yuyu-app
BACKUP_DIR=/www/backup/yuyu-app
KEEP=14
DATE=$(date +%F)

mkdir -p "$BACKUP_DIR"

# 1) 容器内在线热备份 SQLite(比直接 cp 更安全, 备份期间可读写)
docker compose -f "$APP_DIR/docker-compose.yml" exec -T yuyu \
  python -c "import sqlite3; src=sqlite3.connect('/data/app.db'); src.execute(\"VACUUM INTO '/data/app-${DATE}.db'\"); print('snapshot ok')"

# 2) 打包快照 + .env
tar -czf "$BACKUP_DIR/yuyu-backup-${DATE}.tar.gz" \
  -C "$APP_DIR/data" "app-${DATE}.db" \
  -C "$APP_DIR" .env

# 3) 清掉容器内的临时快照
docker compose -f "$APP_DIR/docker-compose.yml" exec -T yuyu rm -f "/data/app-${DATE}.db"

# 4) 只保留最近 KEEP 天
ls -t "$BACKUP_DIR"/yuyu-backup-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[$(date '+%F %T')] backup ok: $BACKUP_DIR/yuyu-backup-${DATE}.tar.gz"
