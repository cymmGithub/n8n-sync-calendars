FROM mcr.microsoft.com/playwright:v1.51.1-jammy
WORKDIR /app
COPY package*.json ./
RUN npm install --ci --omit=dev || npm install --omit=dev
COPY . .
EXPOSE 3001
CMD [ "node", "server.js.js" ]