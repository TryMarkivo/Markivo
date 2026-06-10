FROM node:20-bookworm-slim

# Build tools for better-sqlite3's native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=5000
ENV DB_PATH=/data/markivo.db

EXPOSE 5000
CMD ["node", "server.js"]
