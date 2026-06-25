#!/bin/sh
set -e

# Inject backend address into Nginx config via envsubst
export INTELLECT_HOST="${INTELLECT_HOST:-intellect}"
export PYTHON_API_PORT="${PYTHON_API_PORT:-9380}"
export PYTHON_ADMIN_PORT="${PYTHON_ADMIN_PORT:-9381}"

envsubst '${INTELLECT_HOST} ${PYTHON_API_PORT} ${PYTHON_ADMIN_PORT}' \
  < /etc/nginx/http.d/default.conf.template \
  > /etc/nginx/http.d/default.conf

# Start BFF in background
cd /app/bff && node dist/index.mjs &

# Start Nginx in foreground
exec nginx -g 'daemon off;'
