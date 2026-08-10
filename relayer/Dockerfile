FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json config.json ./
COPY relayer ./relayer
RUN npm run build

ENV NODE_ENV=production
ENV SQLITE_PATH=/data/relayer.db
EXPOSE 10000

CMD ["node", "dist/index.js"]
