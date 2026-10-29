# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=error
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/api/package.json services/api/package.json
COPY apps/entregador-android/package.json apps/entregador-android/package.json
COPY apps/estabelecimento-android/package.json apps/estabelecimento-android/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
RUN --mount=type=secret,id=proxy_ca \
    --mount=type=cache,id=ligeirinho-pnpm,target=/pnpm/store \
    if [ -s /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    export NODE_USE_ENV_PROXY=1; \
    corepack pnpm install --frozen-lockfile --filter ligeirinho --filter @ligeirinho/web... --store-dir /pnpm/store

FROM dependencies AS build
# Public compile-time value. Relative same-origin route expects a reverse proxy.
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY apps/web apps/web
RUN node -e 'const value=process.env.NEXT_PUBLIC_API_URL;if(value!=="/api/v1"){const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password)throw new Error("Production API URL must be HTTPS without credentials");}' && \
    corepack pnpm --filter @ligeirinho/web build && \
    mkdir -p apps/web/public && \
    test -f apps/web/.next/standalone/apps/web/server.js

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    AUTH_PROVIDER=supabase \
    NODE_USE_ENV_PROXY=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3000)+"/").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
CMD ["node", "apps/web/server.js"]
