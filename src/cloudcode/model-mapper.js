/**
 * Model Mapper - Handles model name transformations based on header mode
 *
 * CLI mode: Uses base model names (gemini-3-pro) with thinkingLevel param
 * Antigravity mode: Uses full model names with tier suffix (gemini-3-pro-high)
 */

import { config } from "../config.js";

/**
 * Model aliases for CLI mode - maps tier-suffixed names to CLI API names
 * These are used when geminiHeaderMode is 'cli'
 *
 * Important: Gemini CLI uses -preview suffix for Gemini 3 models
 * (gemini-3-pro-preview, gemini-3-flash-preview)
 */
const CLI_MODEL_ALIASES = {
  // Gemini 3 Pro variants → gemini-3-pro-preview (CLI uses -preview suffix)
  "gemini-3-pro": "gemini-3-pro-preview",
  "gemini-3-pro-low": "gemini-3-pro-preview",
  "gemini-3-pro-medium": "gemini-3-pro-preview",
  "gemini-3-pro-high": "gemini-3-pro-preview",

  // Gemini 3 Flash variants → gemini-3-flash-preview
  "gemini-3-flash": "gemini-3-flash-preview",
  "gemini-3-flash-low": "gemini-3-flash-preview",
  "gemini-3-flash-medium": "gemini-3-flash-preview",
  "gemini-3-flash-high": "gemini-3-flash-preview",

  // Image variants
  "gemini-3-pro-image-preview": "gemini-3-pro-image",

  // Gemini 2.5 aliases (mapping to 2.0 exp/preview models)
  "gemini-2.5-flash-thinking": "gemini-2.0-flash-thinking-exp",
  "gemini-2.5-flash": "gemini-2.0-flash-exp",
  "gemini-2.5-flash-lite": "gemini-2.0-flash-lite-preview-02-05",
  "gemini-2.5-pro": "gemini-2.0-pro-exp-02-05",
};

/**
 * Tier regex for extracting thinking level from model name
 */
const TIER_REGEX = /-(minimal|low|medium|high)$/;

/**
 * Checks if a model supports thinking tiers
 */
function supportsThinkingTiers(model) {
  const lower = model.toLowerCase();
  return (
    lower.includes("gemini-3") ||
    lower.includes("gemini-2.5") ||
    (lower.includes("claude") && lower.includes("thinking"))
  );
}

/**
 * Extracts thinking tier from model name suffix
 */
function extractThinkingTier(model) {
  if (!supportsThinkingTiers(model)) {
    return null;
  }
  const match = model.match(TIER_REGEX);
  return match ? match[1] : null;
}

/**
 * Resolves a model name based on the current header mode
 *
 * @param {string} requestedModel - The model name from the request (e.g., 'gemini-3-pro-high[1m]')
 * @returns {Object} Resolved model info with actualModel, thinkingLevel, and originalModel
 */
export function resolveModelForHeaderMode(requestedModel) {
  // Strip cache suffix (e.g., '[1m]') for resolution
  const cacheSuffix = requestedModel.match(/\[\d+[mhd]\]$/)?.[0] || "";
  const modelWithoutCache = requestedModel.replace(/\[\d+[mhd]\]$/, "");

  const headerMode = config.geminiHeaderMode || "cli";
  const tier = extractThinkingTier(modelWithoutCache);
  const baseName = tier
    ? modelWithoutCache.replace(TIER_REGEX, "")
    : modelWithoutCache;

  // Check if this is a Gemini model
  const isGemini = modelWithoutCache.toLowerCase().startsWith("gemini");
  const isGemini3 = modelWithoutCache.toLowerCase().includes("gemini-3");

  // For non-Gemini models or non-Gemini3 models, return as-is
  if (!isGemini || !isGemini3) {
    return {
      actualModel: requestedModel,
      originalModel: requestedModel,
      thinkingLevel: null,
      headerMode,
    };
  }

  // CLI mode: Use base model name + thinkingLevel param
  if (headerMode === "cli") {
    const actualModel = CLI_MODEL_ALIASES[modelWithoutCache] || baseName;
    return {
      actualModel: actualModel + cacheSuffix,
      originalModel: requestedModel,
      thinkingLevel: tier || (isGemini3 ? "high" : null),
      headerMode,
    };
  }

  // Antigravity mode: Keep full model name with tier suffix
  // If no tier specified for Gemini 3 Pro, default to '-low'
  let actualModel = modelWithoutCache;
  if (modelWithoutCache.toLowerCase().startsWith("gemini-3-pro") && !tier) {
    actualModel = modelWithoutCache + "-low";
  }

  return {
    actualModel: actualModel + cacheSuffix,
    originalModel: requestedModel,
    thinkingLevel: tier,
    headerMode,
  };
}

/**
 * Gets the model name to use in the API request
 */
export function getActualModelName(requestedModel) {
  const resolved = resolveModelForHeaderMode(requestedModel);
  return resolved.actualModel;
}

/**
 * Gets the thinking level for the request (if applicable)
 */
export function getThinkingLevel(requestedModel) {
  const resolved = resolveModelForHeaderMode(requestedModel);
  return resolved.thinkingLevel;
}

/**
 * Checks if the model is a Gemini 3 model
 */
export function isGemini3Model(model) {
  return model.toLowerCase().includes("gemini-3");
}
