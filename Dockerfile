# Imagen de producción del backend (Contabo u otro VPS con Docker).
# Guía: docs/DESPLIEGUE-CONTABO.md

# ---- build ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
# El CLI de Nest es dependencia de desarrollo y hace falta para compilar.
RUN npm ci --include=dev
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate \
  && npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

# ---- runtime -------------------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && chown node:node /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chmod=755 deploy/contabo/entrypoint.sh /usr/local/bin/entrypoint.sh
# /app es del usuario node: el OCR (tesseract) guarda ahí los modelos de idioma
# que descarga la primera vez.
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--", "entrypoint.sh"]
CMD ["node", "dist/main"]
