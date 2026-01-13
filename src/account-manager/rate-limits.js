/**
 * Rate Limit Management
 *
 * Handles rate limit tracking and state management for accounts.
 * All rate limits are model-specific and quota-type aware (CLI vs Antigravity).
 */

import { DEFAULT_COOLDOWN_MS, MAX_CONCURRENT_REQUESTS } from "../constants.js";
import { formatDuration } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";

/**
 * Build a quota key for rate limit storage
 * Format: modelId:quotaType (e.g., "gemini-3-pro-preview:cli")
 *
 * @param {string} modelId - Model ID
 * @param {string} [quotaType] - Quota type ('cli' or 'antigravity')
 * @returns {string} Quota key
 */
function buildQuotaKey(modelId, quotaType = null) {
  if (!quotaType) return modelId;
  return `${modelId}:${quotaType}`;
}

/**
 * Check if all accounts are rate-limited for a specific model and quota type
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model ID to check rate limits
 * @param {string} [quotaType] - Optional quota type to check (e.g., 'cli', 'antigravity')
 * @returns {boolean} True if all enabled accounts are rate limited for the model
 */
export function isAllRateLimited(accounts, modelId, quotaType = null) {
  if (!accounts || accounts.length === 0) return true;

  return accounts.every((acc) => {
    // Skip disabled or invalid accounts (they count as "limited" in the sense that they are not available)
    if (!acc.enabled || acc.isInvalid) return true;

    // Check rate limits
    const key = quotaType ? `${modelId}:${quotaType}` : modelId;
    const limit = acc.modelRateLimits && acc.modelRateLimits[key];
    const isRateLimited =
      limit && limit.isRateLimited && limit.resetTime > Date.now();

    // Check concurrent requests limit
    const activeReqs = acc.activeRequests || 0;
    const isConcurrencyLimited = activeReqs >= MAX_CONCURRENT_REQUESTS;

    return isRateLimited || isConcurrencyLimited;
  });
}

/**
 * Get list of available (non-rate-limited, non-invalid) accounts for a model
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model ID to filter by
 * @param {string} [quotaType] - Quota type ('cli' or 'antigravity')
 * @returns {Array} Array of available account objects
 */
export function getAvailableAccounts(
  accounts,
  modelId = null,
  quotaType = null
) {
  const quotaKey = modelId ? buildQuotaKey(modelId, quotaType) : null;

  return accounts.filter((acc) => {
    if (acc.isInvalid) return false;

    // WebUI: Skip disabled accounts
    if (acc.enabled === false) return false;

    // Check concurrency limit
    if ((acc.activeRequests || 0) >= MAX_CONCURRENT_REQUESTS) return false;

    if (quotaKey && acc.modelRateLimits && acc.modelRateLimits[quotaKey]) {
      const limit = acc.modelRateLimits[quotaKey];
      if (limit.isRateLimited && limit.resetTime > Date.now()) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Get list of invalid accounts
 *
 * @param {Array} accounts - Array of account objects
 * @returns {Array} Array of invalid account objects
 */
export function getInvalidAccounts(accounts) {
  return accounts.filter((acc) => acc.isInvalid);
}

/**
 * Clear expired rate limits
 *
 * @param {Array} accounts - Array of account objects
 * @returns {number} Number of rate limits cleared
 */
export function clearExpiredLimits(accounts) {
  const now = Date.now();
  let cleared = 0;

  for (const account of accounts) {
    if (account.modelRateLimits) {
      for (const [quotaKey, limit] of Object.entries(account.modelRateLimits)) {
        if (limit.isRateLimited && limit.resetTime <= now) {
          limit.isRateLimited = false;
          limit.resetTime = null;
          cleared++;
          logger.success(
            `[AccountManager] Rate limit expired for: ${account.email} (${quotaKey})`
          );
        }
      }
    }
  }

  return cleared;
}

/**
 * Clear rate limits for a specific model (optimistic retry strategy)
 * Only clears limits that match the model ID (and optional quota type)
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model ID to clear limits for
 * @param {string} [quotaType] - Optional quota type
 */
export function resetRateLimitsForModel(accounts, modelId, quotaType = null) {
  const quotaKey = quotaType ? `${modelId}:${quotaType}` : modelId;
  let clearedCount = 0;

  for (const account of accounts) {
    if (account.modelRateLimits) {
      // Check for exact match or prefix match (if modelId is generic)
      // Actually, we usually want exact match for the key we are blocked on.

      // If we have a specific key, just clear that.
      if (account.modelRateLimits[quotaKey]) {
        account.modelRateLimits[quotaKey] = {
          isRateLimited: false,
          resetTime: null,
        };
        clearedCount++;
      }

      // Also check if there are other quota types for the same model if quotaType is null
      if (!quotaType) {
        for (const key of Object.keys(account.modelRateLimits)) {
          if (key === modelId || key.startsWith(`${modelId}:`)) {
            account.modelRateLimits[key] = {
              isRateLimited: false,
              resetTime: null,
            };
            clearedCount++;
          }
        }
      }
    }
  }

  if (clearedCount > 0) {
    logger.warn(
      `[AccountManager] Reset ${clearedCount} rate limits for model ${modelId} (optimistic retry)`
    );
  }
}

/**
 * Clear all rate limits to force a fresh check (optimistic retry strategy)
 *
 * @param {Array} accounts - Array of account objects
 */
export function resetAllRateLimits(accounts) {
  for (const account of accounts) {
    if (account.modelRateLimits) {
      for (const key of Object.keys(account.modelRateLimits)) {
        account.modelRateLimits[key] = {
          isRateLimited: false,
          resetTime: null,
        };
      }
    }
  }
  logger.warn("[AccountManager] Reset all rate limits for optimistic retry");
}

/**
 * Mark an account as rate-limited for a specific model and quota type
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Email of the account to mark
 * @param {number|null} resetMs - Time in ms until rate limit resets (from API)
 * @param {string} modelId - Model ID to mark rate limit for
 * @param {string} [quotaType] - Quota type ('cli' or 'antigravity')
 * @returns {boolean} True if account was found and marked
 */
export function markRateLimited(
  accounts,
  email,
  resetMs = null,
  settings = {},
  modelId,
  quotaType = null
) {
  const account = accounts.find((a) => a.email === email);
  if (!account) return false;

  // Use configured cooldown as the maximum wait time
  // If API returns a reset time, cap it at DEFAULT_COOLDOWN_MS
  // If API doesn't return a reset time, use DEFAULT_COOLDOWN_MS
  let cooldownMs;
  if (resetMs && resetMs > 0) {
    // API provided a reset time - cap it at configured maximum
    cooldownMs = Math.min(resetMs, DEFAULT_COOLDOWN_MS);
  } else {
    // No reset time from API - use configured default
    cooldownMs = DEFAULT_COOLDOWN_MS;
  }
  const resetTime = Date.now() + cooldownMs;

  if (!account.modelRateLimits) {
    account.modelRateLimits = {};
  }

  const quotaKey = buildQuotaKey(modelId, quotaType);
  account.modelRateLimits[quotaKey] = {
    isRateLimited: true,
    resetTime: resetTime,
  };

  const quotaLabel = quotaType ? ` [${quotaType}]` : "";
  logger.warn(
    `[AccountManager] Rate limited: ${email} (model: ${modelId}${quotaLabel}). Available in ${formatDuration(
      cooldownMs
    )}`
  );

  return true;
}

/**
 * Mark an account as invalid (credentials need re-authentication)
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Email of the account to mark
 * @param {string} reason - Reason for marking as invalid
 * @returns {boolean} True if account was found and marked
 */
export function markInvalid(accounts, email, reason = "Unknown error") {
  const account = accounts.find((a) => a.email === email);
  if (!account) return false;

  account.isInvalid = true;
  account.invalidReason = reason;
  account.invalidAt = Date.now();

  logger.error(`[AccountManager] ⚠ Account INVALID: ${email}`);
  logger.error(`[AccountManager]   Reason: ${reason}`);
  logger.error(
    `[AccountManager]   Run 'npm run accounts' to re-authenticate this account`
  );

  return true;
}

/**
 * Get the minimum wait time until any account becomes available for a model
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model identifier
 * @param {string} [quotaType] - Optional quota type
 * @returns {number} Minimum wait time in ms
 */
export function getMinWaitTimeMs(accounts, modelId, quotaType = null) {
  const now = Date.now();
  let minWait = Infinity;
  let activeCount = 0;

  if (!accounts) return 0;

  const key = quotaType ? `${modelId}:${quotaType}` : modelId;

  for (const acc of accounts) {
    if (!acc.enabled || acc.isInvalid) continue;

    // If account is maxed on concurrency, we can't really predict wait time,
    // but we shouldn't treat it as available (wait=0).
    // However, if it's NOT rate limited, it might free up instantly.
    // For now, let's treat concurrency-capped as "check back soon" (default cooldown)
    // or ignore if we are strictly looking for rate limit resets.
    // The original logic seemed to focus on rate limit usage.

    const activeReqs = acc.activeRequests || 0;
    if (activeReqs >= MAX_CONCURRENT_REQUESTS) {
      // If capped by concurrency, we count it as active but effectively unavailable.
      // We don't have a specific reset time for concurrency.
      activeCount++;
      continue;
    }

    const limit = acc.modelRateLimits && acc.modelRateLimits[key];

    if (limit && limit.isRateLimited && limit.resetTime > now) {
      activeCount++;
      const wait = limit.resetTime - now;
      if (wait > 0 && wait < minWait) {
        minWait = wait;
      }
    } else {
      // If any account is valid, enabled, not concurrency capped, and not rate limited
      // then wait time is 0.
      return 0;
    }
  }

  if (activeCount === 0) return 0;
  return minWait === Infinity ? DEFAULT_COOLDOWN_MS : minWait;
}
