import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export class ChinaAIFBrain {
    constructor() {
        this.pool = pool;
    }

    async learn(approvedId, memoryType = 'signal') {
        const allowedTypes = ['signal', 'insight', 'fact'];
        const finalType = allowedTypes.includes(memoryType) ? memoryType : 'signal';
        
        const query = `
            INSERT INTO brain_memory (learning_approved_id, memory_type, content, vector_embedding)
            VALUES ($1, $2, $3, $4)
        `;
        return await this.pool.query(query, [approvedId, finalType, '', null]);
    }
}

export default new ChinaAIFBrain();
