FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN addgroup -S braudle && adduser -S braudle -G braudle
USER braudle

EXPOSE 5000
CMD ["node", "server.js"]
