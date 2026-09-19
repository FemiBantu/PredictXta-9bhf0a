# ── PredictXta Web Production Image ──────────────────────────────────────────
# SDK 57 / React Native 0.79 / API 36 (Google Play compliant)
# Package manager: pnpm (pnpm-lock.yaml is the authoritative lockfile)
# Node 22 LTS required for SDK 57 toolchain (v8 snapshots, Hermes 0.12+)
FROM node:22-alpine

WORKDIR /app

# ── Build-time environment variables ──────────────────────────────────────────
# These EXPO_PUBLIC_ vars are embedded into the static web bundle at build time.
# Pass them via --build-arg in Cloud Build (see cloudbuild.yaml substitutions).
ARG EXPO_PUBLIC_SUPABASE_URL
ARG EXPO_PUBLIC_SUPABASE_ANON_KEY
ENV EXPO_PUBLIC_SUPABASE_URL=${EXPO_PUBLIC_SUPABASE_URL}
ENV EXPO_PUBLIC_SUPABASE_ANON_KEY=${EXPO_PUBLIC_SUPABASE_ANON_KEY}

# ── Install pnpm ───────────────────────────────────────────────────────────────
# pnpm is the authoritative package manager for this project.
# pnpm-lock.yaml must not diverge from package.json.
# Install pnpm via corepack. Node 22 ships corepack; pnpm 10 is the LTS
# version aligned with SDK 57's peer dependency requirements.
RUN corepack enable && corepack prepare pnpm@10 --activate

# ── Dependencies ───────────────────────────────────────────────────────────────
# Copy both manifests so pnpm can validate the lockfile.
COPY package.json pnpm-lock.yaml ./

# --frozen-lockfile ensures the Docker build fails if pnpm-lock.yaml is stale.
RUN pnpm install --frozen-lockfile

# ── Source ─────────────────────────────────────────────────────────────────────
COPY . .

# Write .env AFTER "COPY . ." so the file is not overwritten by an empty .env
# in the repo. Expo's Metro bundler reads this at export time.
RUN echo "EXPO_PUBLIC_SUPABASE_URL=${EXPO_PUBLIC_SUPABASE_URL}" > .env && \
    echo "EXPO_PUBLIC_SUPABASE_ANON_KEY=${EXPO_PUBLIC_SUPABASE_ANON_KEY}" >> .env

# ── Web export ─────────────────────────────────────────────────────────────────
# Expo SDK 57 outputs to /dist (Metro bundler, static output).
# EXPO_METRO_PLATFORM=web ensures babel.config.js applies web shims (not native).
ENV EXPO_METRO_PLATFORM=web
RUN npx expo export --platform web

# ── Runtime server ─────────────────────────────────────────────────────────────
RUN npm install -g serve

EXPOSE 8080

# -s enables SPA fallback: all unknown paths serve dist/index.html
# Required for Expo Router dynamic routes (e.g. /match/[id], /ai-pick/[id])
CMD ["serve", "-s", "dist", "-l", "8080"]
