FROM node:24.8.0-alpine3.22@sha256:3e843c608bb5232f39ecb2b25e41214b958b0795914707374c8acc28487dea17

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY packages/mdx/image/runtime.mjs ./runtime.mjs

RUN addgroup -g 10001 mdx && adduser -D -u 10001 -G mdx mdx
RUN chmod 0444 /app/package.json /app/package-lock.json /app/runtime.mjs && mkdir /input /output && chown 10001:10001 /input /output
USER mdx
CMD ["node", "/app/runtime.mjs"]
