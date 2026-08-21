FROM node:20-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build
RUN npm prune --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/src/server.js"]
