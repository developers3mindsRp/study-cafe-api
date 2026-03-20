FROM node:20-alpine
WORKDIR /app
# Copy full project (now includes shared)
COPY . .
# Move into service folder
WORKDIR /app/services/course-service
RUN npm install --omit=dev
EXPOSE 4002
CMD ["npm", "start"]

