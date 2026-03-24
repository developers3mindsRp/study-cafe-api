FROM node:20-alpine
WORKDIR /app
# Copy full project (includes shared utilities)
COPY . .
# Remove any locally-uploaded files baked into the image; the volume mount takes over at runtime
RUN rm -rf /app/services/platform-service/src/uploads \
 && rm -rf /app/uploads
# Move into service folder and install production dependencies
WORKDIR /app/services/platform-service
RUN npm install --omit=dev
# Pre-create the uploads directory so it exists even without a volume mount
RUN mkdir -p /app/uploads
EXPOSE 4005
CMD ["npm", "start"]