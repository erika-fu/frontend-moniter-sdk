# Build SDK, demo, platform, and server for the Fly single-app demo.
FROM node:22-bookworm AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY demo/package.json demo/
COPY platform/package.json platform/
COPY react-demo/package.json react-demo/
COPY server/package.json server/

RUN npm ci

COPY . .

RUN npm run build \
    && npm run build:server \
    && npm run build:demo \
    && npm run build:platform

# Runtime image: API + static demo/platform on one origin.
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json ./package.json
RUN npm install --omit=dev \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/demo/dist ./public/demo
COPY --from=build /app/platform/dist ./public/platform

ENV NODE_ENV=production
ENV PORT=8080
ENV REPORT_DB_PATH=/data/monitoring.sqlite
ENV RETENTION_DAYS=3
ENV STATIC_ROOT=/app/public
ENV DEMO_ORIGINS=https://frontend-moniter-demo.fly.dev

EXPOSE 8080

CMD ["node", "dist-server/server/index.js"]
