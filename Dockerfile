# Computer Control Explorer — server image.
# Builds the standalone Next server (no dataset baked in) and reads the dataset from a
# volume mounted at DATASET_DIR at runtime. See README.md for the run command.
#
#   docker build -t computer-control-explorer .
#   docker run --rm -p 3000:3000 -v /path/to/bundle:/data:ro -e DATASET_DIR=/data computer-control-explorer

# ---- build ----
FROM node:24-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Default (non-export) target → output: "standalone". No DATASET_DIR needed at build:
# the data layer returns empty and pages render on demand at request time.
RUN npm run build

# ---- run ----
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Standalone server + the static assets it doesn't bundle itself.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

# DATASET_DIR is supplied at runtime (mounted volume). Without it the explorer renders
# an empty state rather than failing.
CMD ["node", "server.js"]
