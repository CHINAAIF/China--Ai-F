FROM node:20-slim

# Install Python, pip, and supervisor
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv supervisor

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install

# Install Python dependencies
COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

# Copy source code
COPY . .

# Expose the Node.js port
EXPOSE 8080

# Start Supervisor (which will manage Node and Python)
CMD ["supervisord", "-c", "supervisord.conf"]
