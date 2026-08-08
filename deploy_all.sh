#!/bin/bash

# 1. التأكد من وجود package.json لدعم الـ modules
if [ ! -f "package.json" ]; then
    echo '{"type": "module"}' > package.json
    echo "✅ Created package.json"
fi

# 2. إنشاء ملف الاختبار إذا لم يكن موجوداً
cat > test_security.js << 'TEST'
import { hashAndSign, verifySignature } from './security-core.js';
process.env.ENCRYPTION_KEY = 'a-very-long-and-secure-random-key-32-chars-minimum!!';
try {
  const { hash, signature } = hashAndSign("Test Data");
  if(verifySignature(hash, signature)) {
      process.exit(0);
  } else {
      process.exit(1);
  }
} catch (e) {
  process.exit(1);
}
TEST

# 3. الفحص (Testing)
echo "🔍 Running Tests..."
node test_security.js
if [ $? -eq 0 ]; then
    echo "✅ Tests Passed!"
else
    echo "❌ Tests Failed! Aborting."
    exit 1
fi

# 4. الرفع (Git & Railway)
echo "🚀 Preparing to push to GitHub..."
git add .
git commit -m "update: security-core and auto-deploy"
git push origin main

echo "📦 Deploying to Railway..."
railway up

echo "🎉 Done! Everything is live."
