FROM node:20-alpine

WORKDIR /app/services/api-gateway

COPY . /app

RUN cd /app/services/api-gateway && npm install --omit=dev

EXPOSE 3000

CMD ["node", "src/server.js"]