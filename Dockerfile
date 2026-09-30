FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV PORT=8787 DATA_DIR=/app/data
EXPOSE 8787
CMD ["node", "server.mjs"]
