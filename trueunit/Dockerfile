# TrueUnit 실행 이미지 — Render, Railway, Fly.io 등 Docker 를 받는 곳이면 그대로 쓸 수 있다.
ARG BASE_IMAGE=node:22-slim
FROM ${BASE_IMAGE}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
# 데이터(db.json, 이미지)는 /data 에 쌓인다. 호스팅에서 이 경로에 영구 디스크(볼륨)를 붙여야 재시작 후에도 남는다.
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
