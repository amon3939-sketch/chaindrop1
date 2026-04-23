FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

RUN pnpm install --frozen-lockfile --filter @chaindrop/shared... --filter @chaindrop/server...

COPY packages/shared ./packages/shared
COPY packages/server ./packages/server

RUN pnpm -F @chaindrop/shared build \
 && pnpm -F @chaindrop/server build

RUN pnpm deploy --filter @chaindrop/server --prod /app/deploy


FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/deploy/package.json ./package.json
COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/packages/server/dist ./dist

EXPOSE 2567
CMD ["node", "dist/index.js"]
