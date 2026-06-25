# ===== Stage 1: Frontend build =====
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
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

# Nginx config
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/proxy.conf /etc/nginx/proxy.conf
COPY nginx/default.conf /etc/nginx/http.d/default.conf.template

# Frontend static assets
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# BFF build output and dependencies
COPY --from=bff-builder /app/bff/dist /app/bff/dist
COPY bff/package.json bff/package-lock.json* /app/bff/
RUN cd /app/bff && npm install --omit=dev --no-audit --no-fund

# Entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
