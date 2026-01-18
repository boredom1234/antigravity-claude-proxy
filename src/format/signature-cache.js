/**
 * Signature Cache
 * In-memory cache for Gemini thoughtSignatures
 *
 * Gemini models require thoughtSignature on tool calls, but Claude Code
 * strips non-standard fields. This cache stores signatures by tool_use_id
 * so they can be restored in subsequent requests.
 *
 * Also caches thinking block signatures with model family for cross-model
 * compatibility checking.
 */

import fs from "fs";
import path from "path";
import {
  GEMINI_SIGNATURE_CACHE_TTL_MS,
  MIN_SIGNATURE_LENGTH,
} from "../constants.js";
import { logger } from "../utils/logger.js";

// Persistence configuration
const CACHE_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "signature-cache.json",
);
const DATA_DIR = path.dirname(CACHE_FILE_PATH);

const signatureCache = new Map();
const thinkingSignatureCache = new Map();
const sessionSignatureCache = new Map();

// Maximum cache sizes to prevent unbounded memory growth
const MAX_SIGNATURE_CACHE_SIZE = 10000;
const MAX_THINKING_CACHE_SIZE = 5000;
const MAX_SESSION_CACHE_SIZE = 1000;

// Cleanup interval reference
let cleanupInterval = null;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Persistence state
let isDirty = false;
let isSaving = false;

/**
 * Load cache from disk
 */
function loadCache() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(CACHE_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, "utf8"));

      // Load signatures
      if (data.signatures) {
        for (const [key, value] of Object.entries(data.signatures)) {
          signatureCache.set(key, value);
        }
      }

      // Load thinking signatures
      if (data.thinkingSignatures) {
        for (const [key, value] of Object.entries(data.thinkingSignatures)) {
          thinkingSignatureCache.set(key, value);
        }
      }

      // Load session signatures
      if (data.sessionSignatures) {
        for (const [key, value] of Object.entries(data.sessionSignatures)) {
          sessionSignatureCache.set(key, value);
        }
      }

      logger.debug(
        `[SignatureCache] Loaded ${signatureCache.size} signatures, ${thinkingSignatureCache.size} thinking signatures, and ${sessionSignatureCache.size} session signatures from disk`,
      );
    }
  } catch (err) {
    logger.error(`[SignatureCache] Failed to load cache: ${err.message}`);
  }
}

/**
 * Save cache to disk
 */
function saveCache() {
  if (!isDirty || isSaving) return;

  isSaving = true;
  try {
    const data = {
      signatures: Object.fromEntries(signatureCache),
      thinkingSignatures: Object.fromEntries(thinkingSignatureCache),
      sessionSignatures: Object.fromEntries(sessionSignatureCache),
    };

    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(data, null, 2));
    isDirty = false;
    logger.debug("[SignatureCache] Saved cache to disk");
  } catch (err) {
    logger.error(`[SignatureCache] Failed to save cache: ${err.message}`);
  } finally {
    isSaving = false;
  }
}

// Load on module initialization
loadCache();

/**
 * Store a signature for a tool_use_id
 * @param {string} toolUseId - The tool use ID
 * @param {string} signature - The thoughtSignature to cache
 */
export function cacheSignature(toolUseId, signature) {
  if (!toolUseId || !signature) return;

  // Evict oldest entries if over limit
  if (signatureCache.size >= MAX_SIGNATURE_CACHE_SIZE) {
    const oldestKey = signatureCache.keys().next().value;
    signatureCache.delete(oldestKey);
    logger.debug(
      `[SignatureCache] Evicted oldest entry, cache size: ${signatureCache.size}`,
    );
  }

  signatureCache.set(toolUseId, {
    signature,
    timestamp: Date.now(),
  });
  isDirty = true;
}

/**
 * Get a cached signature for a tool_use_id
 * @param {string} toolUseId - The tool use ID
 * @returns {string|null} The cached signature or null if not found/expired
 */
export function getCachedSignature(toolUseId) {
  if (!toolUseId) return null;
  const entry = signatureCache.get(toolUseId);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
    signatureCache.delete(toolUseId);
    return null;
  }

  return entry.signature;
}

/**
 * Clear expired entries from the cache
 * Can be called periodically to prevent memory buildup
 * @returns {number} Number of entries cleaned up
 */
export function cleanupCache() {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of signatureCache) {
    if (now - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
      signatureCache.delete(key);
      cleaned++;
    }
  }
  for (const [key, entry] of thinkingSignatureCache) {
    if (now - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
      thinkingSignatureCache.delete(key);
      cleaned++;
    }
  }
  for (const [key, entry] of sessionSignatureCache) {
    if (now - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
      sessionSignatureCache.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(
      `[SignatureCache] Cleaned up ${cleaned} expired entries. Remaining: signatures=${signatureCache.size}, thinking=${thinkingSignatureCache.size}, session=${sessionSignatureCache.size}`,
    );
    isDirty = true;
    saveCache(); // Save after cleanup
  }

  return cleaned;
}

/**
 * Start automatic cache cleanup interval
 * Should be called once at server startup
 */
export function startCacheCleanup() {
  if (cleanupInterval) return; // Already running

  cleanupInterval = setInterval(() => {
    cleanupCache();
    // Also save periodically even if no cleanup happened but dirty
    if (isDirty) saveCache();
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent Node from exiting
  cleanupInterval.unref();

  // Save on exit
  process.on("SIGINT", () => {
    saveCache();
    process.exit();
  });
  process.on("SIGTERM", () => {
    saveCache();
    process.exit();
  });

  logger.debug("[SignatureCache] Started automatic cleanup interval");
}

/**
 * Stop automatic cache cleanup interval
 * Should be called on graceful shutdown
 */
export function stopCacheCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.debug("[SignatureCache] Stopped automatic cleanup interval");
  }
}

/**
 * Get the current cache size (for debugging)
 * @returns {number} Number of entries in the cache
 */
export function getCacheSize() {
  return signatureCache.size;
}

/**
 * Cache a thinking block signature with its model family
 * @param {string} signature - The thinking signature to cache
 * @param {string} modelFamily - The model family ('claude' or 'gemini')
 */
export function cacheThinkingSignature(signature, modelFamily) {
  if (!signature || signature.length < MIN_SIGNATURE_LENGTH) return;

  // Evict oldest entries if over limit
  if (thinkingSignatureCache.size >= MAX_THINKING_CACHE_SIZE) {
    const oldestKey = thinkingSignatureCache.keys().next().value;
    thinkingSignatureCache.delete(oldestKey);
    logger.debug(
      `[SignatureCache] Evicted oldest thinking entry, cache size: ${thinkingSignatureCache.size}`,
    );
  }

  thinkingSignatureCache.set(signature, {
    modelFamily,
    timestamp: Date.now(),
  });
  isDirty = true;
}

/**
 * Get the cached model family for a thinking signature
 * @param {string} signature - The signature to look up
 * @returns {string|null} 'claude', 'gemini', or null if not found/expired
 */
export function getCachedSignatureFamily(signature) {
  if (!signature) return null;
  const entry = thinkingSignatureCache.get(signature);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
    thinkingSignatureCache.delete(signature);
    return null;
  }

  return entry.modelFamily;
}

/**
 * Get the current thinking signature cache size (for debugging)
 * @returns {number} Number of entries in the thinking signature cache
 */
export function getThinkingCacheSize() {
  return thinkingSignatureCache.size;
}

/**
 * Store the latest thinking signature for a session
 * This is the preferred method for tracking signatures across tool loops
 * @param {string} sessionId - Session fingerprint
 * @param {string} signature - The thought signature to store
 */
export function cacheSessionSignature(sessionId, signature) {
  if (!sessionId || !signature) return;

  // Evict oldest entries if over limit
  if (sessionSignatureCache.size >= MAX_SESSION_CACHE_SIZE) {
    const oldestKey = sessionSignatureCache.keys().next().value;
    sessionSignatureCache.delete(oldestKey);
    logger.debug(
      `[SignatureCache] Evicted oldest session entry, cache size: ${sessionSignatureCache.size}`,
    );
  }

  sessionSignatureCache.set(sessionId, {
    signature,
    timestamp: Date.now(),
  });
  isDirty = true;
}

/**
 * Retrieve the latest thinking signature for a session
 * @param {string} sessionId - Session fingerprint
 * @returns {string|null} The cached signature or null if not found/expired
 */
export function getSessionSignature(sessionId) {
  if (!sessionId) return null;
  const entry = sessionSignatureCache.get(sessionId);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
    sessionSignatureCache.delete(sessionId);
    return null;
  }

  return entry.signature;
}

/**
 * Get the current session signature cache size (for debugging)
 * @returns {number} Number of entries in the session signature cache
 */
export function getSessionCacheSize() {
  return sessionSignatureCache.size;
}

/**
 * Clear the signature cache (for testing)
 */
export function clearSignatureCache() {
  signatureCache.clear();
  isDirty = true;
  logger.debug("[SignatureCache] Cleared signature cache");
}

/**
 * Clear the thinking signature cache (for testing)
 */
export function clearThinkingSignatureCache() {
  thinkingSignatureCache.clear();
  isDirty = true;
  logger.debug("[SignatureCache] Cleared thinking signature cache");
}

/**
 * Clear the session signature cache (for testing)
 */
export function clearSessionSignatureCache() {
  sessionSignatureCache.clear();
  isDirty = true;
  logger.debug("[SignatureCache] Cleared session signature cache");
}
