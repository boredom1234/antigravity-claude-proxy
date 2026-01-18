/**
 * Rate Limit Management
 *
 * Handles rate limit tracking and state management for accounts.
 * All rate limits are model-specific and quota-type aware (CLI vs Antigravity).
 */

import {
  DEFAULT_COOLDOWN_MS,
  MAX_CONCURRENT_REQUESTS,
  MIN_QUOTA_FRACTION,
} from "../constants.js";
import { config } from "../config.js";
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
 * Check if a single account is rate-limited for a specific model and quota type
 *
 * @param {Object} account - Account object
 * @param {string} modelId - Model ID
 * @param {string} [quotaType] - Optional quota type
 * @returns {boolean} True if rate limited
 */
export function isAccountRateLimited(account, modelId, quotaType = null) {
  if (!account) return false;
  if (!account.enabled || account.isInvalid) return true;

  const key = buildQuotaKey(modelId, quotaType);
  const limit = account.modelRateLimits && account.modelRateLimits[key];

  // Check if model is manually disabled by quota protection
  if (
    modelId &&
    account.disabledModels &&
    account.disabledModels.includes(modelId)
  ) {
    return true;
  }

  return !!(limit && limit.isRateLimited && limit.resetTime > Date.now());
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
    // Check rate limits
    const isRateLimited = isAccountRateLimited(acc, modelId, quotaType);

    // Check concurrent requests limit
    const activeReqs = acc.activeRequests || 0;
    const isConcurrencyLimited = activeReqs >= MAX_CONCURRENT_REQUESTS;

    // Check quota limit (only for Antigravity mode)
    let isQuotaLimited = false;
    if (
      config.geminiHeaderMode === "antigravity" &&
      modelId &&
      acc.quota?.models?.[modelId]
    ) {
      const quota = acc.quota.models[modelId];
      if (
        typeof quota.remainingFraction === "number" &&
        quota.remainingFraction < MIN_QUOTA_FRACTION
      ) {
        // Only consider it limited if we don't have a reset time, or if reset time is in the future
        const resetTimeMs = quota.resetTime
          ? new Date(quota.resetTime).getTime()
          : null;

        if (!resetTimeMs || resetTimeMs > Date.now()) {
          isQuotaLimited = true;
        }
      }
    }

    return isRateLimited || isConcurrencyLimited || isQuotaLimited;
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
  quotaType = null,
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

    // Check quota limit (only for Antigravity mode)
    if (
      config.geminiHeaderMode === "antigravity" &&
      modelId &&
      acc.quota?.models?.[modelId]
    ) {
      const quota = acc.quota.models[modelId];
      // Also check if model is explicitly disabled (redundant with isAccountRateLimited but good for clarity)
      if (acc.disabledModels && acc.disabledModels.includes(modelId)) {
        return false;
      }
      if (
        typeof quota.remainingFraction === "number" &&
        quota.remainingFraction < MIN_QUOTA_FRACTION
      ) {
        // Only consider it limited if we don't have a reset time, or if reset time is in the future
        const resetTimeMs = quota.resetTime
          ? new Date(quota.resetTime).getTime()
          : null;

        if (!resetTimeMs || resetTimeMs > Date.now()) {
          return false;
        }
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
            `[AccountManager] Rate limit expired for: ${account.email} (${quotaKey})`,
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
      `[AccountManager] Reset ${clearedCount} rate limits for model ${modelId} (optimistic retry)`,
    );
  }
}

/**
 * Optimistically reset rate limits if they're close to expiring
 * This reduces wait time for edge cases where limits expire during checks
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model ID to check
 * @param {number} threshold - Threshold in ms (default 5000)
 * @returns {number} Number of limits reset
 */
export function optimisticReset(accounts, modelId, threshold = 5000) {
  const now = Date.now();
  let resetCount = 0;

  for (const account of accounts) {
    if (account.modelRateLimits) {
      // Check specific model limits
      const limit = account.modelRateLimits[modelId];
      if (limit && limit.isRateLimited && limit.resetTime) {
        const remaining = limit.resetTime - now;
        // If less than threshold remaining, reset optimistically
        if (remaining > 0 && remaining < threshold) {
          limit.isRateLimited = false;
          limit.resetTime = null;
          resetCount++;
          logger.debug(
            `[AccountManager] Optimistic reset for ${account.email} (${remaining}ms remaining)`,
          );
        }
      }
    }
  }

  return resetCount;
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
 * @param {string} [limitType] - Limit type ('rpm' or 'daily')
 * @returns {boolean} True if account was found and marked
 */
export function markRateLimited(
  accounts,
  email,
  resetMs = null,
  settings = {},
  modelId,
  quotaType = null,
  limitType = "rpm",
) {
  const account = accounts.find((a) => a.email === email);
  if (!account) return false;

  // Track health stats
  account.rateLimitHitCount = (account.rateLimitHitCount || 0) + 1;
  account.lastRateLimitedAt = Date.now();

  // Exponential backoff logic
  if (!account.rateLimitStats) account.rateLimitStats = {};
  if (!account.rateLimitStats[modelId])
    account.rateLimitStats[modelId] = { consecutiveFailures: 0 };

  account.rateLimitStats[modelId].consecutiveFailures++;
  const failures = account.rateLimitStats[modelId].consecutiveFailures;

  // Calculate cooldown
  let cooldownMs;

  // 1. Daily Quota: Use long cooldown (1 hour)
  if (limitType === "daily") {
    const DAILY_LIMIT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
    cooldownMs = DAILY_LIMIT_COOLDOWN_MS;
    logger.warn(
      `[AccountManager] Daily quota exhausted for ${email}. Cooling down for 1 hour.`,
    );
  }
  // 2. Standard Reset: Use API reset time if available (capped at default)
  else if (resetMs && resetMs > 0) {
    cooldownMs = Math.min(resetMs, DEFAULT_COOLDOWN_MS);
  }
  // 3. Default: Use configured default
  else {
    cooldownMs = DEFAULT_COOLDOWN_MS;
  }

  // Apply exponential backoff multiplier (for repeated failures only)
  // 10s -> 20s -> 40s -> 80s ... capped at 5 mins (30x of 10s)
  // Only apply to RPM/transient errors, as daily limits have their own long wait
  if (limitType !== "daily" && failures > 1) {
    const backoffMultiplier = Math.min(Math.pow(2, failures - 1), 30);
    cooldownMs = Math.max(cooldownMs, DEFAULT_COOLDOWN_MS * backoffMultiplier);
    logger.debug(
      `[AccountManager] Exponential backoff (${failures} failures): ${formatDuration(cooldownMs)}`,
    );
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
      cooldownMs,
    )}`,
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
    `[AccountManager]   Run 'npm run accounts' to re-authenticate this account`,
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

    // Check quota limit (only for Antigravity mode)
    let isQuotaLimited = false;
    let quotaResetTime = null;

    if (
      config.geminiHeaderMode === "antigravity" &&
      modelId &&
      acc.quota?.models?.[modelId]
    ) {
      const quota = acc.quota.models[modelId];
      if (
        typeof quota.remainingFraction === "number" &&
        quota.remainingFraction < MIN_QUOTA_FRACTION
      ) {
        // Only consider it limited if we don't have a reset time, or if reset time is in the future
        const resetTimeMs = quota.resetTime
          ? new Date(quota.resetTime).getTime()
          : null;

        if (!resetTimeMs || resetTimeMs > Date.now()) {
          isQuotaLimited = true;
          if (resetTimeMs) {
            quotaResetTime = resetTimeMs;
          }
        }
      }
    }

    if (isQuotaLimited) {
      activeCount++;
      if (quotaResetTime) {
        const wait = quotaResetTime - now;
        if (wait > 0 && wait < minWait) {
          minWait = wait;
        }
      }
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

/**
 * Reset consecutive failure count for an account/model on success
 * @param {Object} account - Account object
 * @param {string} modelId - Model ID
 */
export function resetConsecutiveFailures(account, modelId) {
  if (account && account.rateLimitStats && account.rateLimitStats[modelId]) {
    if (account.rateLimitStats[modelId].consecutiveFailures > 0) {
      account.rateLimitStats[modelId].consecutiveFailures = 0;
      logger.debug(
        `[AccountManager] Reset consecutive failures for ${account.email} on ${modelId}`,
      );
    }
  }
}
