FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY proto/ ./proto/

ENV TRANSPORT=http
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js"]
