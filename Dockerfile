FROM oven/bun:1.3
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production
COPY src ./src
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DRY_RUN=true
CMD ["bun", "run", "src/index.ts"]
