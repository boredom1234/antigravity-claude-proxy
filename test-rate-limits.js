import {
  isAllRateLimited,
  getMinWaitTimeMs,
} from "./src/account-manager/rate-limits.js";
import { setDefaultLevel } from "./src/utils/logger.js";

// Mock logger to avoid errors
setDefaultLevel("silent");

const modelId = "gemini-flash";
const quotaType = "cli";

// 1. Test empty accounts
console.log("Test 1: Empty accounts");
console.log("isAllRateLimited([], modelId):", isAllRateLimited([], modelId)); // Should be true

// 2. Test valid account (not limited)
const account1 = {
  email: "test@example.com",
  enabled: true,
  isInvalid: false,
  modelRateLimits: {},
  activeRequests: 0,
};
console.log("\nTest 2: Valid account");
console.log(
  "isAllRateLimited([account1], modelId):",
  isAllRateLimited([account1], modelId)
); // Should be false
console.log(
  "getMinWaitTimeMs([account1], modelId):",
  getMinWaitTimeMs([account1], modelId)
); // Should be 0

// 3. Test rate limited account
const account2 = {
  email: "limited@example.com",
  enabled: true,
  isInvalid: false,
  modelRateLimits: {
    [`${modelId}:${quotaType}`]: {
      isRateLimited: true,
      resetTime: Date.now() + 5000,
    },
  },
  activeRequests: 0,
};
console.log("\nTest 3: Rate limited account");
console.log(
  "isAllRateLimited([account2], modelId, quotaType):",
  isAllRateLimited([account2], modelId, quotaType)
); // Should be true
console.log(
  "getMinWaitTimeMs([account2], modelId, quotaType) > 0:",
  getMinWaitTimeMs([account2], modelId, quotaType) > 0
); // Should be true

// 4. Test mixed accounts (one valid, one limited)
console.log("\nTest 4: Mixed accounts");
const accounts = [account1, account2];
console.log(
  "isAllRateLimited(accounts, modelId, quotaType):",
  isAllRateLimited(accounts, modelId, quotaType)
); // Should be false
console.log(
  "getMinWaitTimeMs(accounts, modelId, quotaType):",
  getMinWaitTimeMs(accounts, modelId, quotaType)
); // Should be 0

console.log("\nDone.");
