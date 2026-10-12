FROM node:24.8.0-alpine3.22@sha256:3e843c608bb5232f39ecb2b25e41214b958b0795914707374c8acc28487dea17

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /staging /dist && chown -R node:node /app /staging /dist

USER node
CMD ["sh", "-c", "mkdir /tmp/site && cp /app/package.json /app/astro.config.mjs /app/tsconfig.json /tmp/site/ && cp -R /app/src /app/public /app/scripts /tmp/site/ && ln -s /app/node_modules /tmp/site/node_modules && cd /tmp/site && node node_modules/astro/bin/astro.mjs build && node scripts/copy-output.mjs"]
