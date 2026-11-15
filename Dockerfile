# Build stage: compile TypeScript with the full toolchain (dev dependencies included).
FROM node:22-alpine AS build
WORKDIR /app

# mongodb-memory-server would download a ~100 MB mongod that only the test suite uses.
ENV MONGOMS_DISABLE_POSTINSTALL=1

# Manifests first: the dependency layer stays cached until package*.json change.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies and compiled output only.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# No dependency needs an install script at runtime; dropping npm's cache keeps the layer small.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
# Read at runtime: served as Swagger UI (/docs) and as JSON (/api/v1/openapi.json).
COPY docs ./docs

# Unprivileged user from the base image; the app files stay root-owned, hence read-only.
USER node
EXPOSE 3000

# Node 22 has a global fetch, so the probe needs neither curl nor wget in the image.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# node itself, not `npm start`: npm does not forward SIGTERM, which would skip graceful shutdown.
CMD ["node", "--enable-source-maps", "dist/server.js"]
