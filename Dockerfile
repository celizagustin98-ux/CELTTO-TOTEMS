# CELTTO-TOTEMS — imagen de producción (Linux / Docker / Proxmox)
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Incluye tsx para poder correr migrate / owner:create / seed desde el contenedor
RUN npm ci --omit=dev && npm install tsx@4.23.15 --no-save && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.server.json ./
EXPOSE 8080
USER node
CMD ["node", "dist/server/index.js"]
