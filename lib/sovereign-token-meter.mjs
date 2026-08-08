/**
 * TRUNKIA Sovereign Token Meter & Financial Engine
 * Implements: Real Token Counting, Atomic Reserve, Smart Refund.
 */

// 1. Approximate Token Counter (4 chars = 1 token)
export function countTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

// 2. Calculate Required Reserve based on Task Tier (Worst-case scenario)
export function getReserveEstimate(inputTokens, tierProfile) {
  const inputCost = inputTokens;
  const outputCost = tierProfile.max_tokens;
  return inputCost + outputCost;
}

// 3. Calculate Actual Cost (Post-Execution for Refund)
export function calculateActualCost(inputTokens, outputTokens) {
  return inputTokens + outputTokens;
}

export default {
  countTokens,
  getReserveEstimate,
  calculateActualCost
};
