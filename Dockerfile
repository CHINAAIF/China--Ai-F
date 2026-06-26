FROM node:20-slim

# Install Python
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install

# Install PM2 globally
RUN npm install -g pm2

# Install Python dependencies
COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

# Copy source code
COPY . .

# Expose the Node.js port
EXPOSE 8080

# Start PM2 using the ecosystem file
CMD ["pm2-runtime", "ecosystem.config.cjs"]
