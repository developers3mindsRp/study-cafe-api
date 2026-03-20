FROM node:20-alpine
WORKDIR /app
# Copy full project (now includes shared)
COPY . .
# Move into service folder
WORKDIR /app/services/platform-service
RUN npm install --omit=dev
EXPOSE 4005
CMD ["npm", "start"]
