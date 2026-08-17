FROM mcr.microsoft.com/devcontainers/javascript-node:20
WORKDIR /app
COPY package*.json ./
COPY src ./src
EXPOSE 3000
CMD ["node", "src/server.js"]
