
import {
  isAllRateLimited,
  getAvailableAccounts,
  getMinWaitTimeMs
} from "./src/account-manager/rate-limits.js";
import { config } from "./src/config.js";

// Mock config
config.geminiHeaderMode = "antigravity";

const now = Date.now();
const FUTURE = now + 10000;
const PAST = now - 10000;

// Test cases
const accounts = [
  {
    email: "valid@test.com",
    enabled: true,
    isInvalid: false,
    modelRateLimits: {},
    activeRequests: 0,
    quota: {
      models: {
        "model-a": { remainingFraction: 0.5, resetTime: null }
      }
    }
  },
  {
    email: "quota-limited@test.com",
    enabled: true,
    isInvalid: false,
    modelRateLimits: {},
    activeRequests: 0,
    quota: {
      models: {
        "model-a": { remainingFraction: 0.0, resetTime: new Date(FUTURE).toISOString() }
      }
    }
  },
  {
    email: "quota-expired@test.com",
    enabled: true,
    isInvalid: false,
    modelRateLimits: {},
    activeRequests: 0,
    quota: {
      models: {
        "model-a": { remainingFraction: 0.0, resetTime: new Date(PAST).toISOString() }
      }
    }
  },
  {
    email: "rate-limited@test.com",
    enabled: true,
    isInvalid: false,
    modelRateLimits: {
      "model-a": { isRateLimited: true, resetTime: FUTURE }
    },
    activeRequests: 0,
    quota: {
        models: {}
    }
  }
];

console.log("--- Testing isAllRateLimited ---");
// Check individual accounts by filtering
const validAccs = [accounts[0]];
console.log("Valid account limited?", isAllRateLimited(validAccs, "model-a")); // Should be false

const quotaLimitedAccs = [accounts[1]];
console.log("Quota limited account limited?", isAllRateLimited(quotaLimitedAccs, "model-a")); // Should be true

const quotaExpiredAccs = [accounts[2]];
console.log("Quota expired account limited?", isAllRateLimited(quotaExpiredAccs, "model-a")); // Should be false (available because reset time passed)

const rateLimitedAccs = [accounts[3]];
console.log("Rate limited account limited?", isAllRateLimited(rateLimitedAccs, "model-a")); // Should be true

console.log("\n--- Testing getAvailableAccounts ---");
const available = getAvailableAccounts(accounts, "model-a");
console.log("Available accounts:", available.map(a => a.email));
// Should include valid@test.com AND quota-expired@test.com
// Should NOT include quota-limited@test.com or rate-limited@test.com

console.log("\n--- Testing getMinWaitTimeMs ---");
const waitTime = getMinWaitTimeMs(accounts, "model-a");
console.log("Min wait time:", waitTime);
// Should be around 10000 (wait for rate-limited or quota-limited, whichever is sooner/available)
// Actually wait, if we have available accounts, wait time should be 0.
console.log("Expected: 0 (since we have available accounts)");

const allLimited = [accounts[1], accounts[3]];
const waitTimeLimited = getMinWaitTimeMs(allLimited, "model-a");
console.log("Wait time (all limited):", waitTimeLimited);
// Should be > 0. accounts[1] resets in 10s. accounts[3] resets in 10s.

