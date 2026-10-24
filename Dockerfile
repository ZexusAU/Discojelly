FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies from the lockfile (reproducible builds).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY setup.js ./

# Run as the unprivileged "node" user that ships with the image.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" >/dev/null || exit 1

CMD ["node", "src/index.js"]
