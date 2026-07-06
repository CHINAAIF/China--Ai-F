# Architecture Decision Records (ADRs)

## 1. Database Protection: TRIGGER vs RULE
- **Decision:** Use smart TRIGGERS for tables with legitimate lifecycles, and absolute RULEs for append-only tables.
- **Reason:** PostgreSQL `RULE` (`ON UPDATE DO INSTEAD NOTHING`) blocks all updates entirely. Application tables like `governance_contracts` require a single legitimate lifecycle transition (`used: false → true`). A RULE breaks the application logic.
- **Implementation:** A BEFORE UPDATE trigger (`enforce_contract_lifecycle`) was created to allow only this specific transition and raise an exception on any other data tampering. Append-only tables (like `audit_logs`) remain protected by strict RULEs.

## 2. Strict Environment & Secrets Management
- **Decision:** No default secrets allowed. The system uses a Fail-Fast environment loader (`config/env.js`).
- **Reason:** Hardcoded fallback secrets (e.g., `process.env.KEY || 'dev'`) create massive security vulnerabilities and can cause silent failures in production.
- **Implementation:** The application checks for mandatory secrets (`DATABASE_URL`, `ENCRYPTION_KEY`, etc.) on startup. If any are missing, the process exits immediately with code 1. Environment isolation is enforced via Neon Branching (Staging vs Production).

## 3. Row Level Security (RLS) & Least Privilege
- **Decision:** Enforce RLS on tenant-sensitive tables (`users`, `api_keys`, `sessions`, etc.) and connect using a restricted application role.
- **Reason:** The default database owner role (`neondb_owner`) has `BYPASSRLS` privileges, rendering RLS policies useless against SQL injection.
- **Implementation:** Created a dedicated `app_user` role with `NOBYPASSRLS`. RLS policies use session variables (`app.current_user_id`) to ensure strict tenant isolation. Verified empirically via penetration testing (User A sees 1 row, unauthenticated sees 0 rows). Unnecessary `DELETE/UPDATE` privileges were revoked from append-only tables.
