/**
 * Quota Balancer
 * 
 * Logic to distribute load based on remaining quota across accounts.
 * Helps prevent prematurely exhausting one account while others are idle.
 */

import { logger } from "../utils/logger.js";
import { MIN_QUOTA_FRACTION } from "../constants.js";

/**
 * Check if an account is rate-limited for a specific model
 * @param {Object} account - Account object
 * @param {string} modelId - Model ID to check
 * @returns {boolean} True if rate-limited
 */
function isAccountRateLimited(account, modelId) {
    if (!account || !modelId) return false;
    if (account.isInvalid) return true;
    if (account.enabled === false) return true;
    
    const limit = account.modelRateLimits?.[modelId];
    return limit && limit.isRateLimited && limit.resetTime > Date.now();
}

/**
 * Check if we should break stickiness for a model
 * Returns true if the current account is low on quota but others have plenty
 * 
 * @param {Object} currentAccount - The currently selected sticky account
 * @param {Array} allAccounts - List of all available accounts
 * @param {string} modelId - The model being requested
 * @returns {boolean} True if we should switch accounts
 */
export function shouldBreakStickiness(currentAccount, allAccounts, modelId) {
    if (!currentAccount || !currentAccount.quota) return false;
    
    const currentQuota = currentAccount.quota.models?.[modelId];
    
    // If we don't know the quota, assume it's fine
    if (!currentQuota) return false;
    
    // If quota is below threshold (e.g. 10%)
    if (currentQuota.remainingFraction !== null && currentQuota.remainingFraction < MIN_QUOTA_FRACTION) {
        // Check if there's another account with significantly more quota (e.g. > 50%)
        const betterAccount = allAccounts.find(acc => {
            if (isAccountRateLimited(acc, modelId)) return false;
            if (acc.email === currentAccount.email) return false; // Skip self
            
            const quota = acc.quota?.models?.[modelId];
            return quota && quota.remainingFraction > 0.5; // significantly more
        });
        
        if (betterAccount) {
            logger.info(`[QuotaBalancer] Breaking stickiness for ${currentAccount.email} (${Math.round(currentQuota.remainingFraction*100)}%) -> Found better option (${Math.round(betterAccount.quota.models[modelId].remainingFraction*100)}%)`);
            return true;
        }
    }
    
    return false;
}

/**
 * Find the account with the best remaining quota for a model
 * 
 * @param {Array} accounts - List of candidate accounts
 * @param {string} modelId - The model being requested
 * @returns {Object|null} The account with the most quota, or null
 */
export function findBestQuotaAccount(accounts, modelId) {
    if (!accounts || accounts.length === 0) return null;
    
    let bestAccount = null;
    let maxFraction = -1;
    
    for (const acc of accounts) {
        // Skip rate-limited or invalid accounts
        if (isAccountRateLimited(acc, modelId)) continue;
        
        const quota = acc.quota?.models?.[modelId];
        // If we don't have quota info, treat as 50% for selection purposes
        // But prefer accounts where we KNOW we have quota
        const fraction = quota?.remainingFraction ?? 0.5; 
        
        if (fraction > maxFraction) {
            maxFraction = fraction;
            bestAccount = acc;
        }
    }
    
    return bestAccount;
}
