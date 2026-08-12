FROM node:20-bookworm-slim

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/migrations ./migrations
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/src/server.js"]
