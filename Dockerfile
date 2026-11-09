FROM node:20-bullseye-slim

# Install system dependencies: ffmpeg and Chromium runtime libraries for Hyperframes
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    fonts-noto-cjk \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source code and assets
COPY . .

# Build TypeScript
RUN npm run build || true

ENV NODE_ENV=production
ENV PORT=3721
ENV CHROME_PATH=/usr/bin/chromium

EXPOSE 3721

CMD ["npx", "tsx", "src/server/app-server.ts"]
