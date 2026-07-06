import { describe, it, expect } from 'vitest';
import '../config/env.js';
import replayGuard from '../agents/governance/replay-guard.js';

describe('Replay Guard (Governance Agent)', () => {
  it('should create a contract, consume it successfully, and detect replay attack', async () => {
    // Run diagnostic (creates contract, consumes it, tries to consume again)
    const result = await replayGuard.runDiagnostic();

    // Verify the first use was successful
    expect(result.first_use.valid).toBe(true);
    expect(result.first_use.reason).toBe('OK');

    // Verify the replay attempt was detected
    expect(result.replay_attempt.valid).toBe(false);
    expect(result.replay_attempt.reason).toBe('REPLAY_DETECTED');
  }, 15000); // 15s timeout for DB operations
});
