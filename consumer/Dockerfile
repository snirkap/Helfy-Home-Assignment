FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create log directory
RUN mkdir -p /var/log/consumer

# Expose metrics port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
