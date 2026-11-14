# Build from repo root: docker build -f services/jev-normalizer/Dockerfile .
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8787 CODEC_CONCURRENCY=2
WORKDIR /app/services/jev-normalizer
COPY services/jev-normalizer/package.json services/jev-normalizer/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/jev-normalizer/*.mjs ./
COPY worker/jev-images.js /app/worker/jev-images.js
COPY services/jev-normalizer/package.json /app/package.json
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
