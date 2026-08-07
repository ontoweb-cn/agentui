# =============================================================================
# 子目录部署 Dockerfile(方案 A:前端在子目录,API 走根路径)
#
# 用法:
#   docker build -f deploy/subpath/Dockerfile \
#     --build-arg SUBPATH=agentui \
#     -t agentui:subpath .
#
# 运行时需注入环境变量(见 deploy/subpath/.env.subpath.example):
#   SUBPATH=agentui
#   BFF_OAUTH_FRONTEND_HOME=/agentui/
#   WARGAME_HOST=wargame-service
#   WARGAME_PORT=9385
#   ...
#
# 注:本 Dockerfile 与根 Dockerfile 共存,不替换原文件。
#     生产可按需选择根部署或子目录部署。
# =============================================================================

# ===== Stage 1: Frontend build =====
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .

# 子目录前缀(构建时注入,如 "agentui";不带前后斜杠)
ARG SUBPATH=agentui
# VITE_BASE_URL 必须以 / 开头并以 / 结尾
ENV VITE_BASE_URL=/${SUBPATH}/

RUN NODE_OPTIONS="--max-old-space-size=8192" \
    VITE_BUILD_SOURCEMAP=false VITE_MINIFY=esbuild \
    npm run build

# ===== Stage 2: BFF build =====
FROM node:20-alpine AS bff-builder
WORKDIR /app/bff
COPY bff/package.json bff/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY bff/ ./
RUN npx esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.mjs

# ===== Stage 3: Production runtime =====
FROM node:20-alpine AS production
RUN apk add --no-cache nginx gettext
WORKDIR /app

ARG SUBPATH=agentui
ENV SUBPATH=${SUBPATH}

# Nginx config(使用 subpath 版本)
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/proxy.conf /etc/nginx/proxy.conf
COPY deploy/subpath/default.conf /etc/nginx/http.d/default.conf.template

# Frontend static assets(放到子目录下,与 VITE_BASE_URL 对齐)
COPY --from=frontend-builder /app/dist /usr/share/nginx/html/${SUBPATH}

# BFF build output and dependencies
COPY --from=bff-builder /app/bff/dist /app/bff/dist
COPY bff/package.json bff/package-lock.json* /app/bff/
RUN cd /app/bff && npm install --omit=dev --no-audit --no-fund

# Entrypoint(使用 subpath 版本)
COPY deploy/subpath/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
