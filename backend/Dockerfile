# build context 为 yuyu-app 根目录
FROM python:3.12-slim

ENV DATA_DIR=/data
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
# 种子库 (首次启动复制为 /data/app.db)
COPY backend/data/seed/yuyu-vocab.db ./app/data/seed/yuyu-vocab.db
# 旧 VOICEVOX 合成语音作为兜底；新源录音按需缓存到 /data/audio-cache
COPY backend/data/audio ./app/data/audio

COPY frontend ./frontend

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
