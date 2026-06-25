#!/bin/sh
set -e

# Inject backend address into Nginx config via envsubst
export INTELLECT_RAG_HOST="${INTELLECT_RAG_HOST:-intellect-rag}"
export PYTHON_API_PORT="${PYTHON_API_PORT:-9380}"
export PYTHON_ADMIN_PORT="${PYTHON_ADMIN_PORT:-9381}"
export BFF_PORT="${BFF_PORT:-9390}"

envsubst '${INTELLECT_RAG_HOST} ${PYTHON_API_PORT} ${PYTHON_ADMIN_PORT} ${BFF_PORT}' \
  < /etc/nginx/http.d/default.conf.template \
  > /etc/nginx/http.d/default.conf

# Start BFF in background
cd /app/bff && node dist/index.mjs &

# Start Nginx in foreground
exec nginx -g 'daemon off;'
