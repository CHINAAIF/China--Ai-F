# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app
# نسخ الملفات من مرحلة البناء
COPY --from=builder /app ./
# إنشاء مستخدم عادي وتغيير الملكية (الأمان السيبراني: لا تعمل بصلاحيات root أبداً)
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/api/system/pulse || exit 1

CMD ["node", "index.js"]
