FROM node:20-slim

# Install Python
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv

# Set working directory
WORKDIR /app

# Copy Node.js files
COPY package*.json ./
RUN npm install

# Copy Python files and install dependencies
COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

# Copy all source code
COPY . .

# Expose port
EXPOSE 8080

# Start both Node.js and Python Sidecar
CMD python3 -m uvicorn sidecar.main:app --host 127.0.0.1 --port 8001 & node index.js
