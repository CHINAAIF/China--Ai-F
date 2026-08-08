
import express from 'express';
import pg from 'pg';
const router = express.Router();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });

router.get('/status', async (req, res) => {
  try {
    const {rows} = await pool.query('SELECT COUNT(*) as ops FROM sovereign_operations');
    res.json({ status: 'active', operations: rows[0].ops });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

export default router;
