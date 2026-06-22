import { pool } from './utils/db.js';
import dotenv from 'dotenv';

dotenv.config();

export class TRUNKIABrain {
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

export const brain = new TRUNKIABrain();
export default brain;
