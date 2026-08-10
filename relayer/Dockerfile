FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json ./
RUN npm install

COPY tsconfig.json config.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV SQLITE_PATH=/data/relayer.db

CMD ["node", "dist/index.js"]
