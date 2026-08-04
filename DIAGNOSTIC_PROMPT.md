==============================================================================
TRUNKIA INTERNAL DIAGNOSTIC REQUEST
==============================================================================
PURPOSE      : Diagnose persistent PostgreSQL authentication failure
TARGET AGENT : Security Core / IAM Gateway / Sovereign Mind
REQUESTOR    : Tier-1 Systems Architect
ENVIRONMENT  : Termux local instance connecting to Neon cloud DB
==============================================================================

[SYMPTOM]
Local instance cannot connect to Neon PostgreSQL database.
Error: "password authentication failed for user 'neondb_owner'"
psql also fails, confirming DB-level auth failure, not code issue.

[QUESTIONS FOR INTERNAL AI]
1. Is the current IP/session trusted in Zero Trust engine?
2. Has trust decayed or has the session been revoked?
3. Is there any IP block or threat flag active?
4. Is the role 'neondb_owner' still valid?
5. Exact steps to restore connection?

Return structured diagnosis and exact commands to fix.
