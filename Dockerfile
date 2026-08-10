FROM node:20-alpine

WORKDIR /app

# ── Build-time environment variables ──────────────────────────────────────────
# These EXPO_PUBLIC_ vars are embedded into the static web bundle at build time.
# Pass them via --build-arg in Cloud Build (see cloudbuild.yaml substitutions).
ARG EXPO_PUBLIC_SUPABASE_URL
ARG EXPO_PUBLIC_SUPABASE_ANON_KEY
ENV EXPO_PUBLIC_SUPABASE_URL=${EXPO_PUBLIC_SUPABASE_URL}
ENV EXPO_PUBLIC_SUPABASE_ANON_KEY=${EXPO_PUBLIC_SUPABASE_ANON_KEY}

# ── Dependencies ───────────────────────────────────────────────────────────────
# Copy lock file with glob so build doesn't fail if package-lock.json is absent
COPY package.json package-lock.json* ./

# Prefer ci (reproducible, fast) with offline cache; fall back to plain install
RUN npm ci --prefer-offline 2>/dev/null || npm install --no-audit --no-fund

# ── Source ─────────────────────────────────────────────────────────────────────
COPY . .

# Write .env AFTER "COPY . ." so the file is not overwritten by an empty .env
# in the repo. Expo's Metro bundler reads this at export time.
RUN echo "EXPO_PUBLIC_SUPABASE_URL=${EXPO_PUBLIC_SUPABASE_URL}" > .env && \
    echo "EXPO_PUBLIC_SUPABASE_ANON_KEY=${EXPO_PUBLIC_SUPABASE_ANON_KEY}" >> .env

# ── Web export ─────────────────────────────────────────────────────────────────
# Expo SDK 50+ outputs to /dist by default (Metro bundler, static output).
# If your project uses an older Expo version that outputs to /web-build,
# replace "dist" with "web-build" in the CMD below.
RUN npx expo export --platform web

# ── Runtime server ─────────────────────────────────────────────────────────────
RUN npm install -g serve

EXPOSE 8080

# -s enables SPA fallback: all unknown paths serve dist/index.html
# Required for Expo Router dynamic routes (e.g. /match/[id], /ai-pick/[id])
CMD ["serve", "-s", "dist", "-l", "8080"]
