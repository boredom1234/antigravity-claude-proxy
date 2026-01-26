/**
 * Hybrid Strategy
 *
 * Smart selection based on health score, token bucket, quota, and LRU freshness.
 * Combines multiple signals for optimal account distribution.
 *
 * Scoring formula:
 *   score = (Health × 2) + ((Tokens / MaxTokens × 100) × 5) + (Quota × 3) + (LRU × 0.1)
 */

import { BaseStrategy } from "./base-strategy.js";
import {
  HealthTracker,
  TokenBucketTracker,
  QuotaTracker,
} from "./trackers/index.js";
import { logger } from "../../utils/logger.js";

// Default weights for scoring
const DEFAULT_WEIGHTS = {
  health: 2,
  tokens: 5,
  quota: 3,
  lru: 0.1,
};

export class HybridStrategy extends BaseStrategy {
  #healthTracker;
  #tokenBucketTracker;
  #quotaTracker;
  #weights;

  /**
   * Create a new HybridStrategy
   * @param {Object} config - Strategy configuration
   */
  constructor(config = {}) {
    super(config);
    this.#healthTracker = new HealthTracker(config.healthScore || {});
    this.#tokenBucketTracker = new TokenBucketTracker(config.tokenBucket || {});
    this.#quotaTracker = new QuotaTracker(config.quota || {});
    this.#weights = { ...DEFAULT_WEIGHTS, ...config.weights };
  }

  /**
   * Select an account based on combined health, tokens, and LRU score
   */
  selectAccount(accounts, modelId, options = {}) {
    const { onSave } = options;

    if (accounts.length === 0) {
      return { account: null, index: 0, waitMs: 0 };
    }

    // Get candidates that pass all filters
    const { candidates, fallbackLevel } = this.#getCandidates(
      accounts,
      modelId,
    );

    if (candidates.length === 0) {
      // Diagnose why no candidates are available and compute wait time
      const { reason, waitMs } = this.#diagnoseNoCandidates(accounts, modelId);
      logger.warn(`[HybridStrategy] No candidates available: ${reason}`);
      return { account: null, index: 0, waitMs };
    }

    // Score and sort candidates
    const scored = candidates.map(({ account, index }) => ({
      account,
      index,
      score: this.#calculateScore(account, modelId),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Select the best candidate
    const best = scored[0];
    best.account.lastUsed = Date.now();

    // Consume a token from the bucket (unless in lastResort mode)
    if (fallbackLevel !== "lastResort") {
      this.#tokenBucketTracker.consume(best.account.email);
    }

    if (onSave) onSave();

    // Calculate throttle wait time based on fallback level
    let waitMs = 0;
    if (fallbackLevel === "lastResort") {
      waitMs = 500;
    } else if (fallbackLevel === "emergency") {
      waitMs = 250;
    }

    const position = best.index + 1;
    const total = accounts.length;
    const fallbackInfo =
      fallbackLevel !== "normal" ? `, fallback: ${fallbackLevel}` : "";
    logger.info(
      `[HybridStrategy] Using account: ${best.account.email} (${position}/${total}, score: ${best.score.toFixed(1)}${fallbackInfo})`,
    );

    return { account: best.account, index: best.index, waitMs };
  }

  onSuccess(account, modelId) {
    if (account?.email) this.#healthTracker.recordSuccess(account.email);
  }

  onRateLimit(account, modelId) {
    if (account?.email) this.#healthTracker.recordRateLimit(account.email);
  }

  onFailure(account, modelId) {
    if (account?.email) {
      this.#healthTracker.recordFailure(account.email);
      this.#tokenBucketTracker.refund(account.email); // Refund token on failure
    }
  }

  #getCandidates(accounts, modelId) {
    // Normal candidates: usable + healthy + has tokens + not critical quota
    const candidates = accounts
      .map((account, index) => ({ account, index }))
      .filter(({ account }) => {
        if (!this.isAccountUsable(account, modelId)) return false;
        if (!this.#healthTracker.isUsable(account.email)) return false;
        if (!this.#tokenBucketTracker.hasTokens(account.email)) return false;
        if (this.#quotaTracker.isQuotaCritical(account, modelId)) return false;
        return true;
      });

    if (candidates.length > 0) return { candidates, fallbackLevel: "normal" };

    // Fallback 1: Ignore quota
    const quotaFallback = accounts
      .map((account, index) => ({ account, index }))
      .filter(({ account }) => {
        if (!this.isAccountUsable(account, modelId)) return false;
        if (!this.#healthTracker.isUsable(account.email)) return false;
        if (!this.#tokenBucketTracker.hasTokens(account.email)) return false;
        return true;
      });
    if (quotaFallback.length > 0)
      return { candidates: quotaFallback, fallbackLevel: "quota" };

    // Fallback 2: Emergency (Ignore health)
    const emergencyFallback = accounts
      .map((account, index) => ({ account, index }))
      .filter(({ account }) => {
        if (!this.isAccountUsable(account, modelId)) return false;
        if (!this.#tokenBucketTracker.hasTokens(account.email)) return false;
        return true;
      });
    if (emergencyFallback.length > 0)
      return { candidates: emergencyFallback, fallbackLevel: "emergency" };

    // Fallback 3: Last Resort (Ignore health and tokens)
    const lastResort = accounts
      .map((account, index) => ({ account, index }))
      .filter(({ account }) => this.isAccountUsable(account, modelId));
    if (lastResort.length > 0)
      return { candidates: lastResort, fallbackLevel: "lastResort" };

    return { candidates: [], fallbackLevel: "normal" };
  }

  #calculateScore(account, modelId) {
    const email = account.email;

    const health = this.#healthTracker.getScore(email);
    const healthComponent = health * this.#weights.health;

    const tokens = this.#tokenBucketTracker.getTokens(email);
    const maxTokens = this.#tokenBucketTracker.getMaxTokens();
    const tokenRatio = tokens / maxTokens;
    const tokenComponent = tokenRatio * 100 * this.#weights.tokens;

    const quotaScore = this.#quotaTracker.getScore(account, modelId);
    const quotaComponent = quotaScore * this.#weights.quota;

    const lastUsed = account.lastUsed || 0;
    const timeSinceLastUse = Math.min(Date.now() - lastUsed, 3600000);
    const lruSeconds = timeSinceLastUse / 1000;
    const lruComponent = lruSeconds * this.#weights.lru;

    return healthComponent + tokenComponent + quotaComponent + lruComponent;
  }

  #diagnoseNoCandidates(accounts, modelId) {
    let unusableCount = 0;
    let unhealthyCount = 0;
    let noTokensCount = 0;
    const emailsNoTokens = [];

    for (const account of accounts) {
      if (!this.isAccountUsable(account, modelId)) {
        unusableCount++;
        continue;
      }
      if (!this.#healthTracker.isUsable(account.email)) {
        unhealthyCount++;
        continue;
      }
      if (!this.#tokenBucketTracker.hasTokens(account.email)) {
        noTokensCount++;
        emailsNoTokens.push(account.email);
        continue;
      }
    }

    if (noTokensCount > 0 && unusableCount === 0 && unhealthyCount === 0) {
      const waitMs =
        this.#tokenBucketTracker.getMinTimeUntilToken(emailsNoTokens);
      return { reason: "waiting for token bucket refill", waitMs };
    }

    return { reason: "all accounts exhausted or unusable", waitMs: 0 };
  }

  getHealthTracker() {
    return this.#healthTracker;
  }
}

export default HybridStrategy;
