/**
 * Error Detection Utilities
 *
 * Provides functions to categorize and detect specific error types
 * for intelligent retry decisions and account management.
 */

import { logger } from "./logger.js";

/**
 * Detect permanent authentication failures that require re-authentication.
 * These are errors where the token/credentials are permanently invalid
 * and retrying won't help - the user must re-authenticate.
 *
 * @param {string} errorText - Error message from API
 * @returns {boolean} True if permanent auth failure
 */
export function isPermanentAuthFailure(errorText) {
  const lower = (errorText || "").toLowerCase();
  return (
    lower.includes("invalid_grant") ||
    lower.includes("token revoked") ||
    lower.includes("token has been expired or revoked") ||
    lower.includes("token_revoked") ||
    lower.includes("invalid_client") ||
    lower.includes("credentials are invalid") ||
    lower.includes("refresh token has expired") ||
    lower.includes("authorization code has expired")
  );
}

/**
 * Detect if 429 error is due to model capacity (server-side) vs user quota.
 * Model capacity issues affect all users and should trigger retry with backoff.
 * User quota issues are account-specific and should trigger account switching.
 *
 * @param {string} errorText - Error message from API
 * @returns {boolean} True if capacity exhausted (not user quota)
 */
export function isModelCapacityExhausted(errorText) {
  const lower = (errorText || "").toLowerCase();
  return (
    lower.includes("model_capacity_exhausted") ||
    lower.includes("capacity_exhausted") ||
    lower.includes("model is currently overloaded") ||
    lower.includes("service temporarily unavailable") ||
    lower.includes("server is overloaded") ||
    lower.includes("too many concurrent requests")
  );
}

/**
 * Rate limit reason types for backoff calculation
 */
export const RateLimitReason = {
  QUOTA_EXHAUSTED: "QUOTA_EXHAUSTED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  MODEL_CAPACITY_EXHAUSTED: "MODEL_CAPACITY_EXHAUSTED",
  SERVER_ERROR: "SERVER_ERROR",
  UNKNOWN: "UNKNOWN",
};

/**
 * Parse the rate limit error to determine the reason type.
 * This enables intelligent backoff decisions based on error type.
 *
 * @param {string} errorText - Error message from API
 * @returns {string} One of RateLimitReason values
 */
export function parseRateLimitReason(errorText) {
  const lower = (errorText || "").toLowerCase();

  // Daily/usage quota exhausted - usually long cooldown needed
  if (
    lower.includes("quota") ||
    lower.includes("daily") ||
    lower.includes("exhausted") ||
    lower.includes("limit exceeded")
  ) {
    // Check if it's capacity vs user quota
    if (isModelCapacityExhausted(errorText)) {
      return RateLimitReason.MODEL_CAPACITY_EXHAUSTED;
    }
    return RateLimitReason.QUOTA_EXHAUSTED;
  }

  // Model capacity - server-side issue, affects all users
  if (
    lower.includes("capacity") ||
    lower.includes("overloaded") ||
    lower.includes("concurrent")
  ) {
    return RateLimitReason.MODEL_CAPACITY_EXHAUSTED;
  }

  // Standard rate limiting - too many requests per second/minute
  if (
    lower.includes("rate") ||
    lower.includes("too many requests") ||
    lower.includes("429") ||
    lower.includes("resource_exhausted")
  ) {
    return RateLimitReason.RATE_LIMIT_EXCEEDED;
  }

  // Server errors
  if (
    lower.includes("server") ||
    lower.includes("internal") ||
    lower.includes("500") ||
    lower.includes("503")
  ) {
    return RateLimitReason.SERVER_ERROR;
  }

  return RateLimitReason.UNKNOWN;
}

/**
 * Backoff times in ms by error type
 * These are recommended delays before retrying based on error classification
 */
export const BACKOFF_BY_REASON = {
  [RateLimitReason.QUOTA_EXHAUSTED]: 60000, // 1 minute - quota issues need time
  [RateLimitReason.RATE_LIMIT_EXCEEDED]: 10000, // 10 seconds - standard rate limit
  [RateLimitReason.MODEL_CAPACITY_EXHAUSTED]: 5000, // 5 seconds - capacity usually clears fast
  [RateLimitReason.SERVER_ERROR]: 15000, // 15 seconds - server needs recovery time
  [RateLimitReason.UNKNOWN]: 30000, // 30 seconds - conservative default
};

/**
 * Get recommended backoff time based on error text
 *
 * @param {string} errorText - Error message from API
 * @param {number|null} serverResetMs - Reset time provided by server (if any)
 * @returns {number} Recommended backoff time in milliseconds
 */
export function getRecommendedBackoff(errorText, serverResetMs = null) {
  // If server provides a reset time, respect it (with minimum floor)
  if (serverResetMs && serverResetMs > 0) {
    return Math.max(serverResetMs, 1000); // At least 1 second
  }

  const reason = parseRateLimitReason(errorText);
  return (
    BACKOFF_BY_REASON[reason] || BACKOFF_BY_REASON[RateLimitReason.UNKNOWN]
  );
}

/**
 * Determine the appropriate action based on error classification
 *
 * @param {string} errorText - Error message from API
 * @returns {{action: string, reason: string}} Action to take and reason
 */
export function getErrorAction(errorText) {
  const reason = parseRateLimitReason(errorText);

  switch (reason) {
    case RateLimitReason.MODEL_CAPACITY_EXHAUSTED:
      return {
        action: "retry_same_account",
        reason: "Model capacity issue - affects all users, retry with backoff",
      };

    case RateLimitReason.QUOTA_EXHAUSTED:
      return {
        action: "switch_account",
        reason: "User quota exhausted - try different account",
      };

    case RateLimitReason.RATE_LIMIT_EXCEEDED:
      return {
        action: "retry_with_backoff",
        reason: "Rate limit hit - wait and retry",
      };

    case RateLimitReason.SERVER_ERROR:
      return {
        action: "retry_with_backoff",
        reason: "Server error - wait for recovery",
      };

    default:
      return {
        action: "switch_account",
        reason: "Unknown error - try different account",
      };
  }
}
