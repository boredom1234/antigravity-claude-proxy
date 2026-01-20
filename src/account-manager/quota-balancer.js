/**
 * Quota Balancer
 *
 * Logic to distribute load based on remaining quota across accounts.
 * Helps prevent prematurely exhausting one account while others are idle.
 */

import { logger } from "../utils/logger.js";
import {
  MIN_QUOTA_FRACTION,
  STICKY_MESSAGE_THRESHOLD,
  STICKY_TOKEN_THRESHOLD,
  ROTATION_QUOTA_THRESHOLD,
} from "../constants.js";

/**
 * Check if an account is rate-limited for a specific model
 * @param {Object} account - Account object
 * @param {string} modelId - Model ID to check
 * @returns {boolean} True if rate-limited
 */
import { isAccountRateLimited } from "./rate-limits.js";

// Re-using the imported helper instead of local definition

/**
 * Check if we should break stickiness for a model
 * Returns true if the current account is low on quota but others have plenty
 *
 * @param {Object} currentAccount - The currently selected sticky account
 * @param {Array} allAccounts - List of all available accounts
 * @param {string} modelId - The model being requested
 * @param {string} quotaType - Optional quota type
 * @param {Object} sessionInfo - Optional session tracking info
 * @returns {boolean} True if we should switch accounts
 */
export function shouldBreakStickiness(
  currentAccount,
  allAccounts,
  modelId,
  quotaType = null,
  sessionInfo = null,
) {
  if (!currentAccount || !currentAccount.quota) return false;

  // Check session-based rotation triggers
  if (sessionInfo) {
    const { messageCount = 0, tokensConsumed = 0 } = sessionInfo;

    // Rule 1: Rotate after N messages (configurable)
    if (messageCount >= STICKY_MESSAGE_THRESHOLD) {
      logger.info(
        `[QuotaBalancer] Breaking stickiness: message count ${messageCount} >= threshold ${STICKY_MESSAGE_THRESHOLD}`,
      );
      return true;
    }

    // Rule 2: Rotate after consuming X tokens in this session (configurable)
    if (tokensConsumed >= STICKY_TOKEN_THRESHOLD) {
      logger.info(
        `[QuotaBalancer] Breaking stickiness: tokens consumed ${tokensConsumed} >= threshold ${STICKY_TOKEN_THRESHOLD}`,
      );
      return true;
    }
  }

  const currentQuota = currentAccount.quota.models?.[modelId];

  // If we don't know the quota, assume it's fine
  if (!currentQuota) return false;

  // Rule 3: Quota-based rotation (more aggressive threshold than usual)
  if (
    currentQuota.remainingFraction !== null &&
    currentQuota.remainingFraction < ROTATION_QUOTA_THRESHOLD
  ) {
    // Check if there's another account with significantly more quota
    const betterAccount = allAccounts.find((acc) => {
      if (isAccountRateLimited(acc, modelId, quotaType)) return false;
      if (acc.email === currentAccount.email) return false; // Skip self

      const quota = acc.quota?.models?.[modelId];
      return (
        quota && quota.remainingFraction > currentQuota.remainingFraction + 0.2
      ); // At least 20% more
    });

    if (betterAccount) {
      logger.info(
        `[QuotaBalancer] Breaking stickiness for ${currentAccount.email} (${Math.round(currentQuota.remainingFraction * 100)}%) -> Found better option (${Math.round(betterAccount.quota.models[modelId].remainingFraction * 100)}%)`,
      );
      return true;
    }
  }

  return false;
}

/**
 * Find the account with the best remaining quota for a model
 * Uses weighted scoring: Quota (70%) + TimeSinceLastUse (30%)
 *
 * @param {Array} accounts - List of candidate accounts
 * @param {string} modelId - The model being requested
 * @param {string} quotaType - Optional quota type
 * @param {number} currentIndex - Current sticky index (unused but kept for API consistency)
 * @returns {Object|null} The account with the best score, or null
 */
export function findBestQuotaAccount(
  accounts,
  modelId,
  quotaType = null,
  currentIndex = 0,
) {
  if (!accounts || accounts.length === 0) return null;

  let bestAccount = null;
  let maxScore = -1;
  const now = Date.now();

  for (const acc of accounts) {
    // Skip rate-limited or invalid accounts
    if (isAccountRateLimited(acc, modelId, quotaType)) continue;
    // Skip disabled accounts (safety check)
    if (acc.enabled === false) continue;

    const quota = acc.quota?.models?.[modelId];
    // If we don't have quota info, treat as 50% for selection purposes
    const fraction = quota?.remainingFraction ?? 0.5;

    // Time factor: accounts not used recently get priority
    // Normalize to 0-1 range based on 1 hour max
    const lastUsed = acc.lastUsed || 0;
    const timeSinceLastUsed = Math.min(now - lastUsed, 3600000); // Cap at 1 hour
    const timeFactor = timeSinceLastUsed / 3600000;

    // Combined score (quota is primary factor)
    // Score range: 0 to 1
    const score = fraction * 0.7 + timeFactor * 0.3;

    if (score > maxScore) {
      maxScore = score;
      bestAccount = acc;
    }
  }

  return bestAccount;
}
