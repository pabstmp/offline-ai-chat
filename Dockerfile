FROM node:22-alpine

WORKDIR /app

# Runtime libs needed by @napi-rs/canvas (skia prebuilt) and tesseract.js wasm.
# libstdc++ + libc6-compat cover the musl→glibc shim some prebuilt natives need.
RUN apk add --no-cache libstdc++ libc6-compat

# Install deps first (cached layer)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Pre-create OCR cache dir; Docker volume will be mounted here for persistence
# of tesseract traineddata files between container restarts.
RUN mkdir -p /app/.cache/tesseract

# Pre-create cron data dir (state file + tarefa output). Um volume nomeado é
# montado aqui no compose para sobreviver a restart/recreate do container.
RUN mkdir -p /app/data/output

# Copy app
COPY app.js index.html server.js sw.js styles.css manifest.webmanifest README.md GUIDE.md ./
COPY modules ./modules
COPY server-lib ./server-lib
COPY assets ./assets

# Containers usually need 0.0.0.0 internally; restrict the external bind in
# docker-compose.yml or at the reverse proxy.
ENV HOST=0.0.0.0
ENV PORT=8080
ENV OCR_CACHE_DIR=/app/.cache/tesseract
ENV CRON_STATE_DIR=/app/data
# Cron desligado por default (opt-in). Ative no compose: CRON_ENABLED=true.
# LAN/company deploy: set auth + WORKSPACE_ROOTS + ALLOWED_LM_HOSTS.
# ENV WORKSPACE_ROOTS=/workspace

EXPOSE 8080

CMD ["node", "server.js"]
