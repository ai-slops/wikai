FROM wikai-site:local
USER root
COPY render.mjs /adapter/render.mjs
RUN chmod 0444 /adapter/render.mjs && chown node:node /dist
USER node
CMD ["node", "/adapter/render.mjs"]
