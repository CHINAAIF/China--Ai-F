# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app
# نسخ ملفات الإنتاج من مرحلة البناء فقط
COPY --from=builder /app ./
# تفعيل وضع الإنتاج
ENV NODE_ENV=production
# فتح البورت الداخلي
EXPOSE 8080
# تفعيل فحص الصحة للتأكد أن الحاوية لا تزال تستجيب
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/api/system/pulse || exit 1
# أمر التشغيل
CMD ["node", "index.js"]
