# Use Node.js 22 as base image
FROM node:22-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Expose port 80
EXPOSE 80

# Set environment variable for port
ENV PORT=80
ENV NODE_ENV=production

# Start the server
CMD ["npm", "start"]
