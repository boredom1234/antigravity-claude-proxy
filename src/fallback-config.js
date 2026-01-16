/**
 * Model Fallback Configuration
 *
 * Defines fallback mappings for when a model's quota is exhausted across all accounts.
 * Enables graceful degradation to alternative models with similar capabilities.
 */

import { MODEL_FALLBACK_MAP } from './constants.js';

// Re-export for convenience
export { MODEL_FALLBACK_MAP };

/**
 * Get the next fallback model for a given model
 * @param {string} modelId - The model ID that failed
 * @returns {string|null} The model ID to try next, or null if no fallback
 */
export function getNextFallback(modelId) {
  return MODEL_FALLBACK_MAP[modelId] || null;
}

/**
 * Get the full chain of fallbacks for a model
 * @param {string} modelId - The starting model ID
 * @returns {string[]} Array of model IDs in fallback order (excluding original)
 */
export function getFallbackChain(modelId) {
  const chain = [];
  const visited = new Set([modelId]);
  let current = MODEL_FALLBACK_MAP[modelId];

  while (current) {
    if (visited.has(current)) break; // Prevent cycles
    chain.push(current);
    visited.add(current);
    current = MODEL_FALLBACK_MAP[current];
  }
  
  return chain;
}

/**
 * Check if a model has a fallback configured
 * @param {string} model - Model ID to check
 * @returns {boolean} True if fallback exists
 */
export function hasFallback(model) {
    return model in MODEL_FALLBACK_MAP;
}
