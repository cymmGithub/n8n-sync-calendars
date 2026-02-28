# Stage 1: Build
FROM mcr.microsoft.com/playwright:v1.57.0 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Runtime
FROM mcr.microsoft.com/playwright:v1.57.0
RUN apt-get update && apt-get install -y vim tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 3001
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]
