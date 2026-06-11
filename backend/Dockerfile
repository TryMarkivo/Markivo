FROM node:20-bookworm-slim

# Build tools for better-sqlite3's native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# Persistent data — mount named volumes here (see docker-compose.yml):
#   /app/database  SQLite file        /app/uploads  user media
RUN mkdir -p /app/database /app/uploads

ENV NODE_ENV=production
ENV PORT=5000
ENV DB_PATH=/app/database/markivo.db

EXPOSE 5000

# Node-based check — the slim image ships neither curl nor wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health',function(r){process.exit(r.statusCode===200?0:1)}).on('error',function(){process.exit(1)})"

CMD ["node", "server.js"]
