FROM mcr.microsoft.com/playwright:v1.55.0
RUN apt-get update && apt-get install -y vim && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --ci --omit=dev || npm install --omit=dev
COPY . .
EXPOSE 3001
CMD [ "node", "server.js" ]
