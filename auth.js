import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

export const auth = betterAuth({
  database: { db: pool, type: 'pg' },
  emailAndPassword: { enabled: true },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  secret: process.env.ENCRYPTION_KEY,
});
