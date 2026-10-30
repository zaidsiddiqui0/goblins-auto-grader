FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production DATA_DIR=/data
EXPOSE 3000
CMD ["npm", "start"]
