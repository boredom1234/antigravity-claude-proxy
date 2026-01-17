/**
 * Account Selection
 *
 * Handles account picking logic (round-robin, sticky) for cache continuity.
 * All rate limit checks are model-specific.
 *
 * Load balancing strategy:
 * - Within a conversation: stay on same account (cache continuity)
 * - New conversations: rotate to next available account (load distribution)
 */

import {
  MAX_WAIT_BEFORE_ERROR_MS,
  STICKY_COOLDOWN_THRESHOLD_MS,
  MAX_CONCURRENT_REQUESTS,
  MIN_QUOTA_FRACTION,
} from "../constants.js";
import { config } from "../config.js";
import { formatDuration } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import { clearExpiredLimits, getAvailableAccounts, isAccountRateLimited } from "./rate-limits.js";
import { shouldBreakStickiness, findBestQuotaAccount } from "./quota-balancer.js";

/**
 * Check if an account is usable for a specific model
 * @param {Object} account - Account object
 * @param {string} modelId - Model ID to check
 * @param {string} [quotaType] - Optional quota type
 * @returns {boolean} True if account is usable
 */
function isAccountUsable(account, modelId, quotaType = null) {
  if (!account) return false;

  if (account.isInvalid) {
    logger.debug(
      `[AccountManager] Account ${account.email} unusable: Invalid state`
    );
    return false;
  }

  // WebUI: Skip disabled accounts
  if (account.enabled === false) {
    logger.debug(
      `[AccountManager] Account ${account.email} unusable: Disabled`
    );
    return false;
  }

  // Check concurrency limit
  if ((account.activeRequests || 0) >= MAX_CONCURRENT_REQUESTS) {
    logger.debug(
      `[AccountManager] Account ${account.email} unusable: Concurrency limit (${account.activeRequests}/${MAX_CONCURRENT_REQUESTS})`
    );
    return false;
  }

  // Check quota limit (only for Antigravity mode)
  if (
    config.geminiHeaderMode === "antigravity" &&
    modelId &&
    account.quota?.models?.[modelId]
  ) {
    const quota = account.quota.models[modelId];
    if (
      typeof quota.remainingFraction === "number" &&
      quota.remainingFraction < MIN_QUOTA_FRACTION
    ) {
      // If reset time has passed, we ignore the low quota and let it try (and potentially fail/refresh)
      const now = Date.now();
      const resetTimeMs = quota.resetTime
        ? new Date(quota.resetTime).getTime()
        : null;

      if (!resetTimeMs || resetTimeMs > now) {
        logger.debug(
          `[AccountManager] Account ${
            account.email
          } unusable: Low quota for ${modelId} (${(
            quota.remainingFraction * 100
          ).toFixed(1)}% < ${MIN_QUOTA_FRACTION * 100}%)`
        );
        return false;
      }
    }
  }

  if (modelId) {
    if (isAccountRateLimited(account, modelId, quotaType)) {
      // Note: isAccountRateLimited already checks expiry, but we log strictly here for debug
      // We need to re-fetch the limit object just for logging reset time if we want detailed logs
      // But standard logging suggests avoiding redundant lookups. 
      // Let's assume isAccountRateLimited returned true accurately.
      logger.debug(
        `[AccountManager] Account ${account.email} unusable: Rate limited on ${modelId} [${quotaType || 'default'}]`
      );
      return false;
    }
  }

  return true;
}

/**
 * Pick the next available account (fallback when current is unavailable).
 *
 * @param {Array} accounts - Array of account objects
 * @param {number} currentIndex - Current account index
 * @param {Function} onSave - Callback to save changes
 * @param {string} [modelId] - Model ID to check rate limits for
 * @param {string} [quotaType] - Optional quota type
 * @returns {{account: Object|null, newIndex: number}} The next available account and new index
 */
export function pickNext(accounts, currentIndex, onSave, modelId = null, quotaType = null) {
  clearExpiredLimits(accounts);

  const available = getAvailableAccounts(accounts, modelId, quotaType);
  if (available.length === 0) {
    return { account: null, newIndex: currentIndex };
  }

  // Clamp index to valid range
  let index = currentIndex;
  if (index >= accounts.length) {
    index = 0;
  }

  // Find next available account starting from index AFTER current
  for (let i = 1; i <= accounts.length; i++) {
    const idx = (index + i) % accounts.length;
    const account = accounts[idx];

    if (isAccountUsable(account, modelId, quotaType)) {
      account.lastUsed = Date.now();

      // Note: "Using account" is logged by message-handler/streaming-handler with request ID

      // Trigger save (don't await to avoid blocking)
      if (onSave) onSave();

      return { account, newIndex: idx };
    }
  }

  return { account: null, newIndex: currentIndex };
}

/**
 * Get the current account without advancing the index (sticky selection).
 *
 * @param {Array} accounts - Array of account objects
 * @param {number} currentIndex - Current account index
 * @param {Function} onSave - Callback to save changes
 * @param {string} [modelId] - Model ID to check rate limits for
 * @param {string} [quotaType] - Optional quota type
 * @returns {{account: Object|null, newIndex: number}} The current account and index
 */
export function getCurrentStickyAccount(
  accounts,
  currentIndex,
  onSave,
  modelId = null,
  quotaType = null
) {
  clearExpiredLimits(accounts);

  if (accounts.length === 0) {
    return { account: null, newIndex: currentIndex };
  }

  // Clamp index to valid range
  let index = currentIndex;
  if (index >= accounts.length) {
    index = 0;
  }

  // Get current account directly (activeIndex = current account)
  const account = accounts[index];

  if (isAccountUsable(account, modelId, quotaType)) {
    account.lastUsed = Date.now();
    // Trigger save (don't await to avoid blocking)
    if (onSave) onSave();
    return { account, newIndex: index };
  }

  return { account: null, newIndex: index };
}

/**
 * Check if we should wait for the current account's rate limit to reset.
 *
 * @param {Array} accounts - Array of account objects
 * @param {number} currentIndex - Current account index
 * @param {string} [modelId] - Model ID to check rate limits for
 * @param {string} [quotaType] - Optional quota type
 * @returns {{shouldWait: boolean, waitMs: number, account: Object|null}}
 */
export function shouldWaitForCurrentAccount(
  accounts,
  currentIndex,
  modelId = null,
  quotaType = null
) {
  if (accounts.length === 0) {
    return { shouldWait: false, waitMs: 0, account: null };
  }

  // Clamp index to valid range
  let index = currentIndex;
  if (index >= accounts.length) {
    index = 0;
  }

  // Get current account directly (activeIndex = current account)
  const account = accounts[index];

  if (!account || account.isInvalid) {
    return { shouldWait: false, waitMs: 0, account: null };
  }

  let waitMs = 0;

  // Check model-specific limit
  if (modelId) {
     if (isAccountRateLimited(account, modelId, quotaType)) {
       // Re-calculate basic wait time
       const key = quotaType ? `${modelId}:${quotaType}` : modelId;
       const limit = account.modelRateLimits && account.modelRateLimits[key];
       if (limit && limit.resetTime) {
         waitMs = limit.resetTime - Date.now();
       }
     }
  }

  // If wait time is within threshold, recommend waiting
  // Use a smaller threshold (5s) for sticky accounts to prefer switching if wait is too long
  // But if NO other accounts are available, we'll end up waiting anyway via the global check
  if (waitMs > 0 && waitMs <= 5000) {
    return { shouldWait: true, waitMs, account };
  }

  return { shouldWait: false, waitMs: 0, account };
}

/**
 * Pick an account with sticky selection preference.
 * Prefers the current account for cache continuity.
 *
 * @param {Array} accounts - Array of account objects
 * @param {number} currentIndex - Current account index
 * @param {Function} onSave - Callback to save changes
 * @param {string} [modelId] - Model ID to check rate limits for
 * @param {string} [sessionId] - Current session ID
 * @param {Map} [sessionMap] - Map of sessionId -> accountEmail
 * @param {string} [quotaType] - Optional quota type
 * @returns {{account: Object|null, waitMs: number, newIndex: number}}
 */
export function pickStickyAccount(
  accounts,
  currentIndex,
  onSave,
  modelId = null,
  sessionId = null,
  sessionMap = null,
  quotaType = null
) {
  let stickyAccount = null;
  let stickyIndex = -1;

  // 1. Try to find mapped account for this session
  if (sessionId && sessionMap && sessionMap.has(sessionId)) {
    const email = sessionMap.get(sessionId);
    const index = accounts.findIndex((a) => a.email === email);

    if (index !== -1) {
      const account = accounts[index];
      // Check if it's usable
      if (isAccountUsable(account, modelId, quotaType)) {
        stickyAccount = account;
        stickyIndex = index;
        // Check if we should break stickiness due to low quota
        if (stickyAccount && shouldBreakStickiness(stickyAccount, accounts, modelId, quotaType)) {
          logger.info(`[AccountManager] Breaking stickiness for ${email} due to low quota/imbalance.`);
          stickyAccount = null;
          // Don't delete from map yet, we'll overwrite it if we find a new one
        }
      } else {
        // Mapped account is unusable (rate limited/invalid)
        // We must switch.
        logger.info(
          `[AccountManager] Sticky account ${email} is currently unusable. Falling back to pool.`
        );
      }
    }
  }

  // 2. If mapped account is found and usable, use it
  if (stickyAccount) {
    stickyAccount.lastUsed = Date.now();
    if (onSave) onSave();
    return { account: stickyAccount, waitMs: 0, newIndex: currentIndex };
  }

  // 3. Fallback: Pick BEST available account (Quota Aware or Round Robin)
  // This balances load for new sessions or when sticky account fails
  
  // Try to find account with best quota first
  let nextAccount = findBestQuotaAccount(accounts, modelId, quotaType);
  let newIndex = currentIndex;
  
  // If no "best" found (or all equal), fall back to round robin
  if (!nextAccount) {
      const result = pickNext(
        accounts,
        currentIndex,
        onSave,
        modelId,
        quotaType
      );
      nextAccount = result.account;
      newIndex = result.newIndex;
  } else {
      // Update index to match selected account
      newIndex = accounts.indexOf(nextAccount);
      // Update lastUsed
      nextAccount.lastUsed = Date.now();
      if (onSave) onSave();
  }

  if (nextAccount) {
    if (sessionId && sessionMap) {
      sessionMap.set(sessionId, nextAccount.email);
      logger.info(
        `[AccountManager] Assigned session ${sessionId.substring(0, 8)}... to ${
          nextAccount.email
        }`
      );
    }
    return { account: nextAccount, waitMs: 0, newIndex };
  }

  // 4. No accounts available at all?
  // Check if we should wait for the *originally mapped* account if it exists
  if (sessionId && sessionMap && sessionMap.has(sessionId)) {
    const email = sessionMap.get(sessionId);
    const index = accounts.findIndex((a) => a.email === email);
    if (index !== -1) {
      // shouldWaitForCurrentAccount supports global wait
      const waitInfo = shouldWaitForCurrentAccount(accounts, index, modelId, quotaType);
      if (waitInfo.shouldWait) {
        return {
          account: null,
          waitMs: waitInfo.waitMs,
          newIndex: currentIndex,
        };
      }
    }
  }

  // Last resort: check global current index wait time
  const waitInfo = shouldWaitForCurrentAccount(accounts, currentIndex, modelId, quotaType);
  return { account: null, waitMs: waitInfo.waitMs, newIndex: currentIndex };
}
