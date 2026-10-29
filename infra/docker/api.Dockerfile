# syntax=docker/dockerfile:1.7
# Build from repository root. Optional proxy_ca secret is a trusted CA bundle;
# mount it only for networked steps, never copy a session CA into an image.
FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN --mount=type=secret,id=proxy_ca \
    if [ -s /run/secrets/proxy_ca ]; then \
      set -- -o Acquire::https::CaInfo=/run/secrets/proxy_ca; \
    else set --; fi; \
    apt-get "$@" update && \
    apt-get "$@" install -y --no-install-recommends ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS dependencies
ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=error
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/api/package.json services/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/entregador-android/package.json apps/entregador-android/package.json
COPY apps/estabelecimento-android/package.json apps/estabelecimento-android/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
COPY services/api/prisma services/api/prisma
RUN --mount=type=secret,id=proxy_ca \
    --mount=type=cache,id=ligeirinho-pnpm,target=/pnpm/store \
    if [ -s /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    export NODE_USE_ENV_PROXY=1; \
    corepack pnpm install --frozen-lockfile --filter ligeirinho --filter @ligeirinho/api... --store-dir /pnpm/store

FROM dependencies AS build
COPY services/api/src services/api/src
COPY services/api/tsconfig.json services/api/tsconfig.json
# This URL is only a schema-generation placeholder; no database is contacted.
RUN --mount=type=secret,id=proxy_ca \
    if [ -s /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    export NODE_USE_ENV_PROXY=1; \
    DATABASE_URL=postgresql://build_only:unused@127.0.0.1/build_only \
      corepack pnpm --filter @ligeirinho/api db:generate && \
    corepack pnpm --filter @ligeirinho/api build && \
    corepack pnpm --filter @ligeirinho/api deploy --legacy --prod /runtime
# pnpm deploy excludes ignored dist and may omit Prisma's generated directory.
# Copy both deliberately and fail the build if the runtime modules cannot load.
RUN mkdir -p /runtime/dist /runtime/prisma && \
    cp -a services/api/dist/. /runtime/dist/ && \
    cp -a services/api/prisma/. /runtime/prisma/ && \
    cd services/api && \
    node -e 'const fs=require("node:fs"),path=require("node:path");const source=require.resolve(".prisma/client/package.json",{paths:[require.resolve("@prisma/client/package.json")]});fs.mkdirSync("/runtime/node_modules/.prisma",{recursive:true});fs.cpSync(path.dirname(source),"/runtime/node_modules/.prisma/client",{recursive:true});' && \
    node -e 'const client=require("/runtime/node_modules/@prisma/client");if(!client.PrismaClient)throw new Error("Prisma client missing");require("/runtime/node_modules/argon2");'

# One-shot migration container uses the CLI retained in the build stage.
# Grant its database identity migration privileges only for this step.
FROM build AS migration
RUN chown -R node:node /app
USER node
CMD ["node", "services/api/node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "services/api/prisma/schema.prisma"]

FROM base AS runtime
ENV NODE_ENV=production PORT=3001 AUTH_PROVIDER=supabase SUPABASE_REQUIRE_EMAIL_CONFIRMED=1
WORKDIR /app
COPY --from=build --chown=node:node /runtime/ ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3001)+"/api/v1/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
CMD ["node", "dist/main.js"]
