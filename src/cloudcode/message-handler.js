/**
 * Message Handler for Cloud Code
 *
 * Handles non-streaming message requests with multi-account support,
 * retry logic, and endpoint failover.
 */

import {
  getEndpointsForHeaderMode,
  MAX_RETRIES,
  MAX_WAIT_BEFORE_ERROR_MS,
  isThinkingModel,
  getModelFamily,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  WAIT_PROGRESS_INTERVAL_MS,
  RETRY_DELAY_MS,
  RATE_LIMIT_BUFFER_MS,
  NETWORK_ERROR_DELAY_MS,
} from "../constants.js";
import { config } from "../config.js";
import { convertGoogleToAnthropic } from "../format/index.js";
import { RateLimitError, isRateLimitError, isAuthError } from "../errors.js";
import { formatDuration, sleep, isNetworkError } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import { parseResetTime } from "./rate-limit-parser.js";
import { buildCloudCodeRequest, buildHeaders } from "./request-builder.js";
import { parseThinkingSSEResponse } from "./sse-parser.js";
import { getFallbackChain } from "../fallback-config.js";
import { deriveSessionId } from "./session-manager.js";
import usageStats from "../modules/usage-stats.js";

/**
 * Send a non-streaming request to Cloud Code with multi-account support
 * Uses SSE endpoint for thinking models (non-streaming doesn't return thinking blocks)
 *
 * @param {Object} anthropicRequest - The Anthropic-format request
 * @param {Object} anthropicRequest.model - Model name to use
 * @param {Array} anthropicRequest.messages - Array of message objects
 * @param {number} [anthropicRequest.max_tokens] - Maximum tokens to generate
 * @param {Object} [anthropicRequest.thinking] - Thinking configuration
 * @param {import('../account-manager/index.js').default} accountManager - The account manager instance
 * @returns {Promise<Object>} Anthropic-format response object
 * @throws {Error} If max retries exceeded or no accounts available
 */
export async function sendMessage(
  anthropicRequest,
  accountManager,
  fallbackEnabled = false,
) {
  const model = anthropicRequest.model;
  const isThinking = isThinkingModel(model);
  const sessionId = deriveSessionId(anthropicRequest);

  // Determine quota type based on header mode (CLI vs default)
  // We only use 'cli' quota type for Gemini models in CLI mode
  const modelFamily = getModelFamily(model);
  const quotaType =
    modelFamily === "gemini" && config.geminiHeaderMode === "cli"
      ? "cli"
      : null;

  logger.debug(
    `[CloudCode] Usage strategy: ${
      quotaType ? "CLI Quota (Isolated)" : "Standard Quota (Shared)"
    }`,
  );

  // Retry loop with account failover
  // Ensure we try at least as many times as there are accounts to cycle through everyone
  // +1 to ensure we hit the "all accounts rate-limited" check at the start of the next loop
  const maxAttempts = Math.max(
    MAX_RETRIES,
    accountManager.getAccountCount() + 1,
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Track retries
    if (attempt > 0) {
      usageStats.trackRetry();
    }
    // Use sticky account selection for cache continuity
    const { account: stickyAccount, waitMs } = accountManager.pickStickyAccount(
      model,
      sessionId,
      quotaType,
    );
    let account = stickyAccount;

    // Handle waiting for sticky account
    if (!account && waitMs > 0) {
      logger.info(
        `[CloudCode] Waiting ${formatDuration(waitMs)} for sticky account...`,
      );
      await sleep(waitMs);
      accountManager.clearExpiredLimits();
      account = accountManager.getCurrentStickyAccount(model, quotaType);
    }

    // Handle all accounts rate-limited
    if (!account) {
      if (accountManager.isAllRateLimited(model, quotaType)) {
        const allWaitMs = accountManager.getMinWaitTimeMs(model, quotaType);
        const resetTime = new Date(Date.now() + allWaitMs).toISOString();

        // Always wait unless configured max is exceeded AND infinite mode is off
        const shouldWait =
          config.infiniteRetryMode || allWaitMs <= MAX_WAIT_BEFORE_ERROR_MS;

        if (!shouldWait) {
          throw new RateLimitError(
            `RESOURCE_EXHAUSTED: Rate limited on ${model}. Quota will reset after ${formatDuration(
              allWaitMs,
            )}. Next available: ${resetTime}`,
            allWaitMs,
          );
        }

        // Wait loop with progress logging
        const waitCount = Math.ceil(allWaitMs / 10000); // 10s chunks
        const accountCount = accountManager.getAccountCount();

        logger.warn(
          `[CloudCode] All ${accountCount} account(s) rate-limited. Waiting ${formatDuration(
            allWaitMs,
          )}...`,
        );

        // Track wait time
        usageStats.trackWait(allWaitMs);

        let waited = 0;
        // Wait in chunks to log progress
        while (waited < allWaitMs) {
          const chunk = Math.min(10000, allWaitMs - waited);
          await sleep(chunk);
          waited += chunk;

          if (waited < allWaitMs) {
            logger.info(
              `[CloudCode] Still waiting... ${formatDuration(allWaitMs - waited)} remaining`,
            );
          }
        }

        // Add small buffer after waiting to ensure rate limits have truly expired
        await sleep(RATE_LIMIT_BUFFER_MS); // Increased buffer

        accountManager.clearExpiredLimits();

        // Try to pick an account again
        account = accountManager.pickNext(model, quotaType);

        // If still no account after waiting, try optimistic reset
        // This handles cases where the API rate limit is transient
        if (!account) {
          logger.warn(
            "[CloudCode] No account available after wait, attempting optimistic reset...",
          );
          accountManager.resetAllRateLimits(); // Reset all is still generic (clears all keys)
          account = accountManager.pickNext(model, quotaType);
        }

        // If we waited and still found nothing, we should continue the loop
        // We decrement attempt to not count "waiting" as a failed try against the retry limit
        if (!account) {
          attempt--;
          await sleep(1000); // Prevent tight loop
          continue;
        }
      } else {
        // Not all rate limited, but pickNext returned null?
        // This implies we have accounts but they are busy (concurrency) or invalid.
        // Wait a bit and retry.
        await sleep(2000);
        attempt--;
        continue;
      }
    }

    accountManager.incrementActiveRequests(account);

    // Log which account is being used for this request
    const requestId = anthropicRequest._requestId || "unknown";
    const accountIndex = accountManager.getAccountIndex?.(account.email) ?? "?";
    const accountCount = accountManager.getAccountCount();
    logger.info(
      `[${requestId}] Using account: ${account.email} (${
        accountIndex + 1
      }/${accountCount})`,
    );

    try {
      // Get token and project for this account
      const token = await accountManager.getTokenForAccount(account);
      const project = await accountManager.getProjectForAccount(account, token);
      const payload = buildCloudCodeRequest(anthropicRequest, project);

      logger.debug(`[CloudCode] Sending request for model: ${model}`);

      // Get endpoints in correct order based on model family and header mode
      // Note: modelFamily is already defined above
      const headerMode =
        modelFamily === "gemini" ? config.geminiHeaderMode : "antigravity";
      const endpoints = getEndpointsForHeaderMode(headerMode);

      // Try each endpoint
      let lastError = null;
      for (const endpoint of endpoints) {
        try {
          // Force SSE for Sonnet 4.5 as generateContent endpoint appears unstable/hanging
          const useSSE = isThinking || model === "claude-sonnet-4-5";

          const url = useSSE
            ? `${endpoint}/v1internal:streamGenerateContent?alt=sse`
            : `${endpoint}/v1internal:generateContent`;

          const response = await fetch(url, {
            method: "POST",
            headers: buildHeaders(
              token,
              model,
              useSSE ? "text/event-stream" : "application/json",
            ),
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const errorText = await response.text();
            logger.warn(
              `[CloudCode] Error at ${endpoint}: ${response.status} - ${errorText}`,
            );

            if (response.status === 401) {
              // Auth error - clear caches and retry with fresh token
              logger.warn("[CloudCode] Auth error, refreshing token...");
              accountManager.clearTokenCache(account.email);
              accountManager.clearProjectCache(account.email);
              continue;
            }

            if (response.status === 429) {
              // Rate limited on this endpoint - try next endpoint first (DAILY → PROD)
              logger.debug(
                `[CloudCode] Rate limited at ${endpoint}, trying next endpoint...`,
              );
              const resetMs = parseResetTime(response, errorText);
              // Keep minimum reset time across all 429 responses
              if (
                !lastError?.is429 ||
                (resetMs && (!lastError.resetMs || resetMs < lastError.resetMs))
              ) {
                lastError = { is429: true, response, errorText, resetMs };
              }
              continue;
            }

            if (response.status >= 400) {
              lastError = new Error(
                `API error ${response.status}: ${errorText}`,
              );
              // If it's a 5xx error, wait a bit before trying the next endpoint
              if (response.status >= 500) {
                logger.warn(
                  `[CloudCode] ${response.status} error, waiting 1s before retry...`,
                );
                await sleep(1000);
              }
              continue;
            }
          }

          // For thinking models or forced SSE, parse SSE and accumulate all parts
          if (useSSE) {
            const result = await parseThinkingSSEResponse(
              response,
              anthropicRequest.model,
            );

            // Log token usage
            if (result.usage) {
              const {
                input_tokens = 0,
                output_tokens = 0,
                cache_read_input_tokens = 0,
              } = result.usage;
              const totalTokens = input_tokens + output_tokens;
              logger.info(
                `[Tokens] Input: ${input_tokens}, Output: ${output_tokens}, Total: ${totalTokens}${
                  cache_read_input_tokens > 0
                    ? `, Cached: ${cache_read_input_tokens}`
                    : ""
                }`,
              );
              // Track tokens for dashboard
              usageStats.trackTokens(
                input_tokens,
                output_tokens,
                cache_read_input_tokens,
                headerMode,
              );
            }

            if (attempt > 0) {
              usageStats.trackRetrySuccess();
            }
            return result;
          }

          // Non-thinking models use regular JSON
          const data = await response.json();
          logger.debug("[CloudCode] Response received");
          const result = convertGoogleToAnthropic(data, anthropicRequest.model);

          // Log token usage
          if (result.usage) {
            const {
              input_tokens = 0,
              output_tokens = 0,
              cache_read_input_tokens = 0,
            } = result.usage;
            const totalTokens = input_tokens + output_tokens;
            logger.info(
              `[Tokens] Input: ${input_tokens}, Output: ${output_tokens}, Total: ${totalTokens}${
                cache_read_input_tokens > 0
                  ? `, Cached: ${cache_read_input_tokens}`
                  : ""
              }`,
            );
            // Track tokens for dashboard
            usageStats.trackTokens(
              input_tokens,
              output_tokens,
              cache_read_input_tokens,
              headerMode,
            );
          }

          if (attempt > 0) {
            usageStats.trackRetrySuccess();
          }
          return result;
        } catch (endpointError) {
          if (isRateLimitError(endpointError)) {
            throw endpointError; // Re-throw to trigger account switch
          }
          logger.warn(
            `[CloudCode] Error at ${endpoint}:`,
            endpointError.message,
          );
          lastError = endpointError;
        }
      }

      // If all endpoints failed for this account
      if (lastError) {
        // If all endpoints returned 429, mark account as rate-limited
        if (lastError.is429) {
          logger.warn(
            `[CloudCode] All endpoints rate-limited for ${account.email}`,
          );
          accountManager.markRateLimited(
            account.email,
            lastError.resetMs,
            model,
            quotaType,
          );
          throw new Error(`Rate limited: ${lastError.errorText}`);
        }
        throw lastError;
      }
    } catch (error) {
      if (isRateLimitError(error)) {
        // Rate limited - already marked, continue to next account
        logger.info(
          `[CloudCode] Account ${account.email} rate-limited, trying next...`,
        );
        continue;
      }
      if (isAuthError(error)) {
        // Auth invalid - already marked, continue to next account
        logger.warn(
          `[CloudCode] Account ${account.email} has invalid credentials, trying next...`,
        );
        continue;
      }
      // Non-rate-limit error: throw immediately
      // UNLESS it's a 500 error, then we treat it as a "soft" failure for this account and try the next one
      if (
        error.message.includes("API error 5") ||
        error.message.includes("500") ||
        error.message.includes("503")
      ) {
        logger.warn(
          `[CloudCode] Account ${account.email} failed with 5xx error, trying next...`,
        );
        accountManager.pickNext(model, quotaType); // Force advance to next account
        continue;
      }

      if (isNetworkError(error)) {
        logger.warn(
          `[CloudCode] Network error for ${account.email}, trying next account... (${error.message})`,
        );
        await sleep(1000); // Brief pause before retry
        accountManager.pickNext(model, quotaType); // Advance to next account
        continue;
      }

      throw error;
    } finally {
      accountManager.decrementActiveRequests(account);
    }
  }

  // All retries exhausted - try fallback model chain
  if (fallbackEnabled) {
    const fallbackChain = getFallbackChain(model);
    if (fallbackChain && fallbackChain.length > 0) {
      logger.warn(
        `[CloudCode] All retries exhausted for ${model}. Attempting fallback chain: ${fallbackChain.join(
          " -> ",
        )}`,
      );

      for (const fallbackModel of fallbackChain) {
        try {
          logger.info(`[CloudCode] Trying fallback model: ${fallbackModel}`);
          usageStats.trackFallback(model, fallbackModel);
          const fallbackRequest = { ...anthropicRequest, model: fallbackModel };
          // Do NOT enable fallback for these calls to avoid infinite loops,
          // as we manage the chain here.
          return await sendMessage(fallbackRequest, accountManager, false);
        } catch (err) {
          logger.warn(
            `[CloudCode] Fallback ${fallbackModel} failed: ${err.message}`,
          );
          // Continue to next fallback in chain
        }
      }
    }
  }

  throw new Error("Max retries exceeded");
}
