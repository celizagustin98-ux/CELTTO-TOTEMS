# CELTTO-TOTEMS — build multi-stage
# El contenedor de runtime NO incluye código fuente TypeScript/React.

# ---- build ----
# Node 22: varias dependencias (kysely, i18next, tedious) lo requieren
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.server.json tsconfig.web.json vite.config.ts ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev \
  && rm -rf src tsconfig.web.json vite.config.ts

# ---- runtime (solo artefactos) ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r celtto && useradd -r -g celtto -d /app -s /sbin/nologin celtto

COPY package.json package-lock.json ./
# Sin dependencias opcionales: better-sqlite3 es solo para pruebas y no se usa en producción
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY --from=build /app/dist ./dist

# Sin src/, sin tests, sin .env, sin mapas de fuente
USER celtto
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server/index.js"]
