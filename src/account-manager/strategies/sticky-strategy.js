/**
 * Sticky Strategy
 *
 * Keeps using the same account until it becomes unavailable (rate-limited or invalid).
 * Best for prompt caching as it maintains cache continuity across requests.
 */

import { BaseStrategy } from "./base-strategy.js";
import { logger } from "../../utils/logger.js";
import { formatDuration } from "../../utils/helpers.js";
import { MAX_WAIT_BEFORE_ERROR_MS } from "../../constants.js";

export class StickyStrategy extends BaseStrategy {
  /**
   * Create a new StickyStrategy
   * @param {Object} config - Strategy configuration
   */
  constructor(config = {}) {
    super(config);
  }

  /**
   * Select an account with sticky preference
   * Prefers the current account for cache continuity, only switches when:
   * - Current account is rate-limited for > threshold
   * - Current account is invalid
   * - Current account is disabled
   *
   * @param {Array} accounts - Array of account objects
   * @param {string} modelId - The model ID for the request
   * @param {Object} options - Additional options
   * @returns {SelectionResult} The selected account and index
   */
  selectAccount(accounts, modelId, options = {}) {
    const { currentIndex = 0, onSave, sessionId, sessionMap } = options;

    if (accounts.length === 0) {
      return { account: null, index: currentIndex, waitMs: 0 };
    }

    // 1. Try to find mapped account for this session
    if (sessionId && sessionMap && sessionMap.has(sessionId)) {
      const email = sessionMap.get(sessionId);
      const index = accounts.findIndex((a) => a.email === email);
      if (index !== -1) {
        const account = accounts[index];
        if (this.isAccountUsable(account, modelId)) {
          account.lastUsed = Date.now();
          if (onSave) onSave();
          return { account, index, waitMs: 0 };
        }
      }
    }

    // 2. Try the current overall index
    let index = currentIndex >= accounts.length ? 0 : currentIndex;
    const currentAccount = accounts[index];

    if (this.isAccountUsable(currentAccount, modelId)) {
      if (sessionId && sessionMap)
        sessionMap.set(sessionId, currentAccount.email);
      currentAccount.lastUsed = Date.now();
      if (onSave) onSave();
      return { account: currentAccount, index, waitMs: 0 };
    }

    // 3. Current account is not usable - check if others are available
    const usableAccounts = this.getUsableAccounts(accounts, modelId);

    if (usableAccounts.length > 0) {
      // Pick next starting from index
      const result = this.#pickNext(accounts, index, modelId, onSave);
      if (result.account && sessionId && sessionMap) {
        sessionMap.set(sessionId, result.account.email);
      }
      return { ...result, waitMs: 0 };
    }

    // 4. No other accounts available - check if we should wait for current
    const waitInfo = this.#shouldWaitForAccount(currentAccount, modelId);
    if (waitInfo.shouldWait) {
      logger.info(
        `[StickyStrategy] Waiting ${formatDuration(waitInfo.waitMs)} for sticky account: ${currentAccount.email}`,
      );
      return { account: null, index, waitMs: waitInfo.waitMs };
    }

    // 5. Still nothing? Just return current index and null
    return { account: null, index, waitMs: 0 };
  }

  /**
   * Pick the next available account starting from after the current index
   * @private
   */
  #pickNext(accounts, currentIndex, modelId, onSave) {
    for (let i = 1; i <= accounts.length; i++) {
      const idx = (currentIndex + i) % accounts.length;
      const account = accounts[idx];

      if (this.isAccountUsable(account, modelId)) {
        account.lastUsed = Date.now();
        if (onSave) onSave();

        const position = idx + 1;
        const total = accounts.length;
        logger.info(
          `[StickyStrategy] Using account: ${account.email} (${position}/${total})`,
        );

        return { account, index: idx };
      }
    }

    return { account: null, index: currentIndex };
  }

  /**
   * Check if we should wait for an account's rate limit to reset
   * @private
   */
  #shouldWaitForAccount(account, modelId) {
    if (!account || account.isInvalid || account.enabled === false) {
      return { shouldWait: false, waitMs: 0 };
    }

    let waitMs = 0;

    if (modelId) {
      const key = modelId; // Could be extended with quotaType if needed
      if (account.modelRateLimits && account.modelRateLimits[key]) {
        const limit = account.modelRateLimits[key];
        if (limit.isRateLimited && limit.resetTime) {
          waitMs = limit.resetTime - Date.now();
        }
      }
    }

    // Wait if within threshold
    if (waitMs > 0 && waitMs <= MAX_WAIT_BEFORE_ERROR_MS) {
      return { shouldWait: true, waitMs };
    }

    return { shouldWait: false, waitMs: 0 };
  }
}

export default StickyStrategy;
