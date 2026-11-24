# Imagem do app para rodar localmente (docker compose up). Não é usada pela Vercel.
FROM node:24-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec next build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
