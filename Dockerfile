# ---- build stage: install everything, compile, then drop dev dependencies ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build
RUN npm prune --omit=dev

# ---- runtime stage: only what the server needs ----
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    MTG_RULES_DB_PATH=/app/data/rules.sqlite \
    MTG_RULES_MODEL_DIR=/app/models

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Download the embedding model into the image, then forbid downloads at runtime.
RUN node dist/scripts/warm-up.js
ENV MTG_RULES_OFFLINE=1

# Bake in the database, switched out of WAL mode so it opens cleanly read-only.
COPY data/rules.sqlite ./data/rules.sqlite
RUN node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/rules.sqlite');db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.exec('PRAGMA journal_mode = DELETE');db.close()"

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server/index.js"]