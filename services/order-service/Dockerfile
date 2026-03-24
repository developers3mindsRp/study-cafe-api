FROM node:20-alpine
WORKDIR /app
# Copy full project (now includes shared)
COPY . .
# Move into service folder
WORKDIR /app/services/order-service
RUN npm install --omit=dev
EXPOSE 4003
CMD ["npm", "start"]