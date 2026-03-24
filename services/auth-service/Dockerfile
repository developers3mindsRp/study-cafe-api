FROM node:20-alpine
WORKDIR /app
# Copy full project (now includes shared)
COPY . .
# Move into service folder
WORKDIR /app/services/auth-service
RUN npm install --omit=dev
EXPOSE 4001
CMD ["npm", "start"]
