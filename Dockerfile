FROM node:20-slim

# Install Python and curl (for health check)
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv curl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["sh", "start.sh"]
