import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "./utils/logger.js";

// Default config
const DEFAULT_CONFIG = {
  apiKey: "",
  authToken: "", // Token for API authentication (ANTHROPIC_AUTH_TOKEN)
  webuiPassword: "",
  debug: false,
  logLevel: "info",
  maxRetries: 5,
  retryBaseMs: 1000,
  retryMaxMs: 30000,
  persistTokenCache: false,
  defaultCooldownMs: 10000, // 10 seconds
  maxWaitBeforeErrorMs: 600000, // 10 minutes
  geminiHeaderMode: "cli", // 'cli' or 'antigravity'
  maxContextTokens: 500000, // Default to 500k tokens for context window
  maxConcurrentRequests: 5, // Default concurrent requests per account
  infiniteRetryMode: false, // When true, never error on rate limits - wait indefinitely
  autoFallback: true, // Automatically fall back to alternative models
  waitProgressUpdates: true, // Send SSE events while waiting for rate limits
  aggressiveRetry: true, // Retry more aggressively on transient errors
  modelMapping: {},
  defaultThinkingLevel: null, // 'minimal', 'low', 'medium', 'high' or null
  defaultThinkingBudget: 16000, // Default thinking budget in tokens
  // Account selection strategy configuration
  accountSelection: {
    strategy: "hybrid", // 'sticky' | 'round-robin' | 'hybrid'
    // Hybrid strategy tuning
    healthScore: {
      initial: 70, // Starting score for new accounts
      successReward: 1, // Points on successful request
      rateLimitPenalty: -10, // Points on rate limit
      failurePenalty: -20, // Points on other failures
      recoveryPerHour: 2, // Passive recovery rate
      minUsable: 50, // Minimum score to be selected
      maxScore: 100, // Maximum score cap
    },
    tokenBucket: {
      maxTokens: 50, // Maximum token capacity
      tokensPerMinute: 6, // Regeneration rate
      initialTokens: 50, // Starting tokens
    },
    quota: {
      lowThreshold: 0.1, // 10% - reduce score
      criticalThreshold: 0.05, // 5% - exclude from candidates
      staleMs: 300000, // 5 min - max age of quota data to trust
    },
  },
};

// Env Var Mapping (Env Name -> Config Key)
const ENV_MAPPING = {
  AUTH_TOKEN: "authToken",
  WEBUI_PASSWORD: "webuiPassword",
  DEBUG: "debug",
  LOG_LEVEL: "logLevel",
  MAX_RETRIES: "maxRetries",
  RETRY_BASE_MS: "retryBaseMs",
  RETRY_MAX_MS: "retryMaxMs",
  PERSIST_TOKEN_CACHE: "persistTokenCache",
  DEFAULT_COOLDOWN_MS: "defaultCooldownMs",
  MAX_WAIT_BEFORE_ERROR_MS: "maxWaitBeforeErrorMs",
  GEMINI_HEADER_MODE: "geminiHeaderMode",
  MAX_CONTEXT_TOKENS: "maxContextTokens",
  MAX_CONCURRENT_REQUESTS: "maxConcurrentRequests",
  INFINITE_RETRY_MODE: "infiniteRetryMode",
  AUTO_FALLBACK: "autoFallback",
  WAIT_PROGRESS_UPDATES: "waitProgressUpdates",
  AGGRESSIVE_RETRY: "aggressiveRetry",
  DEFAULT_THINKING_LEVEL: "defaultThinkingLevel",
  DEFAULT_THINKING_BUDGET: "defaultThinkingBudget",
};

// Config locations
const HOME_DIR = os.homedir();
const CONFIG_DIR = path.join(HOME_DIR, ".config", "antigravity-proxy");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Ensure config dir exists
if (!fs.existsSync(CONFIG_DIR)) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  } catch (err) {
    // Ignore
  }
}

let config = { ...DEFAULT_CONFIG };

/**
 * Type conversion for env vars
 */
function parseEnvValue(key, value, currentValue) {
  if (typeof currentValue === "boolean") {
    return value === "true" || value === "1";
  }
  if (typeof currentValue === "number") {
    const parsed = Number(value);
    return isNaN(parsed) ? currentValue : parsed;
  }
  return value;
}

/**
 * Validate configuration values
 * Logs warnings for invalid values and resets them to defaults
 * @param {Object} cfg - Configuration object to validate
 * @returns {Object} Validated configuration
 */
function validateConfig(cfg) {
  const validated = { ...cfg };
  const warnings = [];

  // Validate numeric values with ranges
  const numericRanges = {
    maxRetries: { min: 1, max: 20, default: DEFAULT_CONFIG.maxRetries },
    retryBaseMs: { min: 100, max: 60000, default: DEFAULT_CONFIG.retryBaseMs },
    retryMaxMs: { min: 1000, max: 300000, default: DEFAULT_CONFIG.retryMaxMs },
    defaultCooldownMs: {
      min: 1000,
      max: 600000,
      default: DEFAULT_CONFIG.defaultCooldownMs,
    },
    maxWaitBeforeErrorMs: {
      min: 5000,
      max: 3600000, // 1 hour
      default: DEFAULT_CONFIG.maxWaitBeforeErrorMs,
    },
    maxContextTokens: {
      min: 0,
      max: 10000000,
      default: DEFAULT_CONFIG.maxContextTokens,
    },
    maxConcurrentRequests: {
      min: 1,
      max: 50,
      default: DEFAULT_CONFIG.maxConcurrentRequests,
    },
    defaultThinkingBudget: {
      min: 0,
      max: 128000,
      default: DEFAULT_CONFIG.defaultThinkingBudget,
    },
  };

  for (const [key, range] of Object.entries(numericRanges)) {
    if (validated[key] !== undefined) {
      const value = Number(validated[key]);
      if (isNaN(value) || value < range.min || value > range.max) {
        warnings.push(
          `${key} must be between ${range.min} and ${range.max}, got ${validated[key]}`,
        );
        validated[key] = range.default;
      } else {
        validated[key] = value;
      }
    }
  }

  // Validate boolean fields
  const booleanFields = [
    "debug",
    "persistTokenCache",
    "infiniteRetryMode",
    "autoFallback",
    "waitProgressUpdates",
    "aggressiveRetry",
  ];
  for (const key of booleanFields) {
    if (validated[key] !== undefined && typeof validated[key] !== "boolean") {
      validated[key] = String(validated[key]) === "true";
    }
  }

  // Validate logLevel
  const validLogLevels = ["debug", "info", "warn", "error"];
  if (validated.logLevel && !validLogLevels.includes(validated.logLevel)) {
    warnings.push(
      `logLevel must be one of ${validLogLevels.join(", ")}, got ${
        validated.logLevel
      }`,
    );
    validated.logLevel = DEFAULT_CONFIG.logLevel;
  }

  // Validate geminiHeaderMode
  const validHeaderModes = ["cli", "antigravity"];
  if (
    validated.geminiHeaderMode &&
    !validHeaderModes.includes(validated.geminiHeaderMode)
  ) {
    warnings.push(
      `geminiHeaderMode must be one of ${validHeaderModes.join(", ")}, got ${
        validated.geminiHeaderMode
      }`,
    );
    validated.geminiHeaderMode = DEFAULT_CONFIG.geminiHeaderMode;
  }

  // Validate thinking level
  const validThinkingLevels = ["minimal", "low", "medium", "high", null];
  if (
    validated.defaultThinkingLevel !== undefined &&
    !validThinkingLevels.includes(validated.defaultThinkingLevel)
  ) {
    if (validated.defaultThinkingLevel !== null) {
      warnings.push(
        `defaultThinkingLevel must be one of ${validThinkingLevels
          .filter((l) => l !== null)
          .join(", ")}, got ${validated.defaultThinkingLevel}`,
      );
      validated.defaultThinkingLevel = DEFAULT_CONFIG.defaultThinkingLevel;
    }
  }

  // Validate modelMapping is an object
  if (
    validated.modelMapping !== undefined &&
    typeof validated.modelMapping !== "object"
  ) {
    warnings.push("modelMapping must be an object");
    validated.modelMapping = {};
  }

  // Validate accountSelection
  if (
    validated.accountSelection !== undefined &&
    typeof validated.accountSelection !== "object"
  ) {
    validated.accountSelection = DEFAULT_CONFIG.accountSelection;
  }

  // Log warnings
  for (const warning of warnings) {
    logger.warn(`[Config] Warning: ${warning}`);
  }

  return validated;
}

function loadConfig() {
  try {
    let loadedConfig = { ...DEFAULT_CONFIG };

    // 1. Load File Config
    if (fs.existsSync(CONFIG_FILE)) {
      const fileContent = fs.readFileSync(CONFIG_FILE, "utf8");
      const userConfig = JSON.parse(fileContent);
      loadedConfig = { ...loadedConfig, ...userConfig };
    } else {
      // Fallback to local config.json
      const localConfigPath = path.resolve("config.json");
      if (fs.existsSync(localConfigPath)) {
        const fileContent = fs.readFileSync(localConfigPath, "utf8");
        const userConfig = JSON.parse(fileContent);
        loadedConfig = { ...loadedConfig, ...userConfig };
      }
    }

    // 2. Apply Environment Overrides
    for (const [envName, configKey] of Object.entries(ENV_MAPPING)) {
      if (process.env[envName] !== undefined) {
        loadedConfig[configKey] = parseEnvValue(
          configKey,
          process.env[envName],
          DEFAULT_CONFIG[configKey],
        );
      }
    }

    // 3. Validate final config
    config = validateConfig(loadedConfig);
  } catch (error) {
    console.error("[Config] Error loading config:", error);
    // Fallback to defaults on catastrophic failure
    config = validateConfig(DEFAULT_CONFIG);
  }
}

// Initial load
loadConfig();

export function getPublicConfig() {
  return { ...config };
}

export function saveConfig(updates) {
  try {
    // Validate updates before applying
    const validatedUpdates = validateConfig({ ...config, ...updates });
    config = validatedUpdates;

    // Save to disk
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
    return true;
  } catch (error) {
    logger.error("[Config] Failed to save config:", error);
    return false;
  }
}

export { config };
