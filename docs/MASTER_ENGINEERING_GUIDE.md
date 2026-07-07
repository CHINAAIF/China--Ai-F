# TRUNKIA — دليل الهندسة والعمليات الشامل (Master Engineering Guide)

هذا المستند هو المرجع المركزي والمطلق لفهم بنية نظام TRUNKIA، سياسات الأمان، طرق التشغيل، وبروتوكولات التطوير المستقبلي. 

---

## 1. نظرة عامة على البنية المعمارية (Architecture Overview)
نظام TRUNKIA هو نظام حوكمة ووكلاء ذكاء اصطناعي متعدد، مبني بالكامل على بيئة **Node.js**، ويعتمد على معمارية "الإنتاج أولاً" (Production-First) و"الثقة الصفرية" (Zero-Trust).

- **اللغة الأساسية:** Node.js (ES Modules) — قرار محسوم (راجع ADR-003).
- **قاعدة البيانات:** PostgreSQL (مستضاف على Neon) مع فصل صارم للبيئات (Staging/Branching).
- **البنية التحتية المستقبلية:** حاويات Docker خلف شبكة Zero-Trust عبر Cloudflare Tunnels (بدون منافذ مفتوحة).

---

## 2. إنجازات وترقيات البنية التحتية (Infrastructure Achievements)
تم تنفيذ الترقيات التالية لضمان مستوى مؤسسي عالي (Enterprise Grade):

1. **المراقبة (Observability):**
   - دمج `@sentry/node` لالتقاط الاستثناءات غير المعالجة وتتبع مسارات Express.
   - جدولة `governance-monitor.js` للعمل كل 6 ساعات عبر `node-cron` للتحقق من سلامة الجداول.
   - التنبيهات الحرجة تُرسل عبر Webhook إلى قنوات العمليات.

2. **الأمان السيبراني والتشغيلي (Security & Resilience):**
   - **Strict CORS:** تم إغلاق ثغرة `*` الافتراضية. النظام الآن يرفض أي طلب لا يطابق القائمة البيضاء صراحة في بيئة الإنتاج.
   - **Adaptive Load Shedding:** طبقة ذكية تحمي النظام من الانهيار تحت الضغط (DDoS أو بطء قاعدة البيانات). إذا انخفضت درجة الصحة تحت 40، يرفض النظام الطلبات برمز 503 لحماية نفسه.
   - **Cloudflare Real IP Extraction:** استخراج الـ IP الحقيقي للمستخدم لضمان عمل Rate Limiting بشكل دقيق ومنع حظر Cloudflare بالخطأ.
   - **Graceful Shutdown:** النظام يتلقى إشارة `SIGTERM` من Railway/Docker ويقوم بإغلاق الاتصالات برفق (Zero-Downtime Deployments) دون إسقاط الطلبات الحالية.

3. **قاعدة البيانات (Database Engineering):**
   - **Dynamic Pool Sizing:** تجمع اتصالات ديناميكي قابل للتوسع عبر متغيرات البيئة (`DB_POOL_MAX`).
   - **Slow Query Logging:** تسجيل آلي لأي استعلام يتجاوز 500 مللي ثانية لمراقبة الأداء.
   - **حماية (Append-Only & Lifecycle):** 
     - **RULE-based:** جداول الأحداث الخالصة (مثل `canary_tokens`) تمنع التحديث والحذف بصمت.
     - **TRIGGER-based:** جداول دورة الحياة (مثل `intel_quarantine`) تسمح بالتحديث الخاضع لمنطق صارم وتمنع الحذف.
     - تم اختبار هذه الحمايات آلياً عبر `Vitest` لمنع أي تعارض (راجع ADR-001).

4. **CI/CD (Continuous Integration):**
   - خط أنابيب مؤسسي يفحص تاريخ Git الكامل بـ Gitleaks.
   - فحص SAST شامل عبر Semgrep (OWASP Top 10, SQL Injection).
   - اختبارات Vitest و npm audit كبوابات إلزامية قبل الدمج (Merge Gates).

---

## 3. بروتوكول التطوير المستقبلي (Future Development Protocol)
عند الرغبة في إضافة ميزة جديدة أو تعديل الكود، يجب اتباع هذا البروتوكول الصارم:

1. **فحص البيئة (Environment Check):**
   - قبل إضافة أي متغير جديد لـ `config/env.js` كـ "إلزامي"، يجب جلب قائمة متغيرات بيئة الإنتاج (Railway/Laptop) ومقارنتها. (درس مستفاد من حادثة الـ 24 ساعة - ADR-004).
2. **التطوير المحلي (Local Dev):**
   - يتم التطوير والاختبار على بيئة Staging (`.env.staging`) المعزولة عبر Neon Branching.
3. **الاختبار الآلي (Automated Testing):**
   - أي ميزة جديدة تتعلق بقاعدة البيانات أو الأمان يجب أن يُكتب لها اختبار في `tests/` باستخدام `Vitest`.
4. **المراجعة والدمج (PR & Merge):**
   - يُمنع الدفع المباشر لـ `main` للتعديلات الكبيرة. يجب فتح Pull Request ليتولى الـ CI/CD فحصها (Gitleaks + Semgrep).
5. **توثيق القرارات (ADRs):**
   - أي قرار معماري جديد (تغيير قاعدة بيانات، تبني مكتبة جديدة، تغيير سياسة أمان) يجب توثيقه في `docs/architecture-decisions.md`.

---

## 4. خطة الانتقال للابتوب (Laptop Migration Plan - Zero-Trust Edge)
عند توفر الابتوب، سيتم التخلي عن Railway والاعتماد على البنية المحلية المحصنة. الخطوات كالتالي:

**المرحلة 1: التجهيز**
1. تثبيت Docker Desktop و Git.
2. استنساخ المستودع: `git clone https://github.com/CHINAAIF/China--Ai-F.git`
3. نسخ ملف `.env.production` من الهاتف إلى جذر المشروع على الابتوب.

**المرحلة 2: إعداد Cloudflare Tunnel**
1. الذهاب إلى Cloudflare Zero Trust -> Networks -> Tunnels.
2. إنشاء نفق جديد ونسخ الـ Token.
3. لصق الـ Token في `.env.production` تحت اسم `CLOUDFLARE_TUNNEL_TOKEN`.
4. ربط الدومين (مثلاً `api.trunkia.com`) بالخدمة `http://trunkia-api:8080`.

**المرحلة 3: الإقلاع**
- من طرفية الابتوب، تنفيذ الأمر:
  `docker-compose up -d --build`
- النظام سيعمل خلف جدار ناري مطلق (No Open Ports) ويمرر الطلبات عبر النفق المشفر.

---

## 5. الفهارس (Indexes)
- **الأدوار والصلاحيات:** راجع `docs/access-roles.md`
- **قرارات المعمارية:** راجع `docs/architecture-decisions.md`
