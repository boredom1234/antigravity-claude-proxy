/**
 * Rate Limit Management
 *
 * Handles rate limit tracking and state management for accounts.
 * All rate limits are model-specific and quota-type aware (CLI vs Antigravity).
 */

import { DEFAULT_COOLDOWN_MS } from "../constants.js";
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
 * @param {string} modelId - Model ID to check rate limits for
 * @param {string} [quotaType] - Quota type ('cli' or 'antigravity')
 * @returns {boolean} True if all accounts are rate-limited
 */
export function isAllRateLimited(accounts, modelId, quotaType = null) {
  if (accounts.length === 0) return true;
  if (!modelId) return false; // No model specified = not rate limited

  const quotaKey = buildQuotaKey(modelId, quotaType);

  return accounts.every((acc) => {
    if (acc.isInvalid) return true; // Invalid accounts count as unavailable
    // WebUI: Skip disabled accounts
    if (acc.enabled === false) return true;

    const modelLimits = acc.modelRateLimits || {};
    const limit = modelLimits[quotaKey];
    return limit && limit.isRateLimited && limit.resetTime > Date.now();
  });
}

/**
 * Get list of available (non-rate-limited, non-invalid) accounts for a model
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} [modelId] - Model ID to filter by
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
 * @param {number|null} resetMs - Time in ms until rate limit resets
 * @param {Object} settings - Settings object with cooldownDurationMs
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

  const cooldownMs =
    resetMs || settings.cooldownDurationMs || DEFAULT_COOLDOWN_MS;
  const resetTime = Date.now() + cooldownMs;
  const quotaKey = buildQuotaKey(modelId, quotaType);

  if (!account.modelRateLimits) {
    account.modelRateLimits = {};
  }

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
 * @param {string} modelId - Model ID to check
 * @param {string} [quotaType] - Quota type ('cli' or 'antigravity')
 * @returns {number} Wait time in milliseconds
 */
export function getMinWaitTimeMs(accounts, modelId, quotaType = null) {
  if (!isAllRateLimited(accounts, modelId, quotaType)) return 0;

  const now = Date.now();
  const quotaKey = buildQuotaKey(modelId, quotaType);
  let minWait = Infinity;
  let soonestAccount = null;

  for (const account of accounts) {
    if (account.modelRateLimits && account.modelRateLimits[quotaKey]) {
      const limit = account.modelRateLimits[quotaKey];
      if (limit.isRateLimited && limit.resetTime) {
        const wait = limit.resetTime - now;
        if (wait > 0 && wait < minWait) {
          minWait = wait;
          soonestAccount = account;
        }
      }
    }
  }

  if (soonestAccount) {
    const quotaLabel = quotaType ? ` [${quotaType}]` : "";
    logger.info(
      `[AccountManager] Shortest wait${quotaLabel}: ${formatDuration(
        minWait
      )} (account: ${soonestAccount.email})`
    );
  }

  return minWait === Infinity ? DEFAULT_COOLDOWN_MS : minWait;
}
