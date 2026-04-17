FROM node:20-alpine
WORKDIR /app
# Monorepo context: include shared/ and root package for file:../.. (studycafe-ms)
COPY . .
WORKDIR /app/services/api-gateway
RUN npm install --omit=dev
EXPOSE 3000
CMD ["npm", "start"]
