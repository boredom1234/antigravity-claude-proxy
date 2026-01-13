#!/usr/bin/env node

/**
 * Stats CLI - Usage statistics commands
 *
 * Commands:
 *   stats             Show session summary
 *   stats session     Show session-specific stats (duration, totals)
 *   stats model       Show per-model usage breakdown
 *   stats limits      Show account quota limits
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

// Box drawing characters
const box = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
};

/**
 * Format duration from milliseconds to human readable
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60));

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Format number with commas
 */
function formatNumber(num) {
  return num.toLocaleString();
}

/**
 * Fetch stats from the proxy server
 */
async function fetchFromProxy(endpoint) {
  const baseUrl = process.env.PROXY_URL || "http://localhost:8672";
  try {
    const response = await fetch(`${baseUrl}${endpoint}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.error(
        `${colors.red}Error: Cannot connect to proxy at ${baseUrl}${colors.reset}`
      );
      console.error("Make sure the proxy server is running: npm start");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Show session stats summary (gemini-cli style)
 */
async function showSessionStats() {
  console.log(`\n${colors.dim}Fetching stats from proxy...${colors.reset}\n`);

  const [sessionInfo, tokenStats, accountLimits, history] = await Promise.all([
    fetchFromProxy("/api/stats/session"),
    fetchFromProxy("/api/stats/tokens"),
    fetchFromProxy("/account-limits"),
    fetchFromProxy("/api/stats/history"),
  ]);

  // Calculate totals from history
  let totalRequests = 0;
  const modelCounts = {};

  for (const hourData of Object.values(history)) {
    totalRequests += hourData._total || 0;
    for (const [family, familyData] of Object.entries(hourData)) {
      if (family.startsWith("_")) continue;
      for (const [model, count] of Object.entries(familyData)) {
        if (model.startsWith("_")) continue;
        const fullModel = `${family}-${model}`;
        modelCounts[fullModel] = (modelCounts[fullModel] || 0) + count;
      }
    }
  }

  // Account status
  const accountStatus = accountLimits.accounts || [];
  const okAccounts = accountStatus.filter((a) => a.status === "ok").length;
  const limitedAccounts = accountStatus.filter((a) => a.status !== "ok").length;

  // Calculate cache efficiency
  const totalInput = tokenStats.input || 0;
  const cached = tokenStats.cached || 0;
  const cacheEfficiency =
    totalInput > 0 ? ((cached / totalInput) * 100).toFixed(1) : 0;

  // Get best quota for each model (across all accounts)
  const modelQuotas = {};
  for (const account of accountStatus) {
    const limits = account.limits || {};
    for (const [model, quota] of Object.entries(limits)) {
      if (!quota || quota.remainingFraction === null) continue;
      if (
        !modelQuotas[model] ||
        quota.remainingFraction > modelQuotas[model].remainingFraction
      ) {
        modelQuotas[model] = quota;
      }
    }
  }

  // Build output
  const width = 75;
  const output = [];

  // Top border
  output.push(
    `${colors.dim}${box.topLeft}${box.horizontal.repeat(width - 2)}${
      box.topRight
    }${colors.reset}`
  );

  // Title
  const title = "Session Stats";
  const titlePadding = Math.floor((width - 4 - title.length) / 2);
  output.push(
    `${colors.dim}${box.vertical}${colors.reset}${" ".repeat(titlePadding)}${
      colors.bold
    }${colors.cyan}${title}${colors.reset}${" ".repeat(
      width - 4 - titlePadding - title.length
    )}${colors.dim}${box.vertical}${colors.reset}`
  );
  output.push(
    `${colors.dim}${box.vertical}${colors.reset}${" ".repeat(width - 4)}${
      colors.dim
    }${box.vertical}${colors.reset}`
  );

  // Helper to add a line
  const addLine = (content) => {
    const plain = content.replace(/\x1b\[[0-9;]*m/g, "");
    const padding = Math.max(0, width - 4 - plain.length);
    output.push(
      `${colors.dim}${box.vertical}${colors.reset} ${content}${" ".repeat(
        padding
      )}${colors.dim}${box.vertical}${colors.reset}`
    );
  };

  // Interaction Summary section
  addLine(`${colors.bold}Interaction Summary${colors.reset}`);
  addLine(
    `  Session ID:          ${colors.dim}${sessionInfo.sessionId.slice(
      0,
      8
    )}...${colors.reset}`
  );
  addLine(
    `  Total Requests:      ${colors.bold}${formatNumber(totalRequests)}${
      colors.reset
    }`
  );
  addLine(
    `  Accounts:            ${colors.green}${okAccounts} active${
      colors.reset
    }, ${
      limitedAccounts > 0 ? colors.yellow : colors.dim
    }${limitedAccounts} limited${colors.reset}`
  );
  addLine("");

  // Performance section
  addLine(`${colors.bold}Performance${colors.reset}`);
  addLine(`  Wall Time:           ${formatDuration(sessionInfo.wallTimeMs)}`);
  addLine(
    `  Total Tokens:        ${formatNumber(tokenStats.total || 0)} ${
      colors.dim
    }(in: ${formatNumber(tokenStats.input || 0)}, out: ${formatNumber(
      tokenStats.output || 0
    )})${colors.reset}`
  );
  addLine(
    `  Cache Efficiency:    ${
      cached > 0 ? colors.green : colors.dim
    }${cacheEfficiency}%${colors.reset} ${colors.dim}(${formatNumber(
      cached
    )} tokens cached)${colors.reset}`
  );
  addLine("");

  // Model Usage table
  const sortedModels = Object.entries(modelCounts).sort(
    ([, a], [, b]) => b - a
  );

  if (sortedModels.length > 0) {
    addLine(
      `${colors.bold}${"Model Usage".padEnd(28)}${"Reqs".padStart(
        8
      )}          Usage left${colors.reset}`
    );
    addLine(`${colors.dim}${"─".repeat(width - 6)}${colors.reset}`);

    for (const [model, count] of sortedModels.slice(0, 8)) {
      // Show top 8 models
      const quota = modelQuotas[model];
      let usageLeft = `${colors.dim}-${colors.reset}`;

      if (quota && quota.remainingFraction !== null) {
        const pct = Math.round(quota.remainingFraction * 100);
        const pctColor =
          pct === 0 ? colors.red : pct < 25 ? colors.yellow : colors.green;

        let resetInfo = "";
        if (quota.resetTime) {
          const resetMs = new Date(quota.resetTime).getTime() - Date.now();
          if (resetMs > 0) {
            const hours = Math.floor(resetMs / (1000 * 60 * 60));
            const mins = Math.floor((resetMs / (1000 * 60)) % 60);
            resetInfo = ` ${colors.dim}(Resets in ${hours}h ${mins}m)${colors.reset}`;
          }
        }
        usageLeft = `${pctColor}${pct}%${colors.reset}${resetInfo}`;
      }

      const familyColor = model.startsWith("claude")
        ? colors.magenta
        : model.startsWith("gemini")
        ? colors.blue
        : colors.cyan;
      addLine(
        `  ${familyColor}${model.padEnd(26)}${colors.reset}${formatNumber(
          count
        ).padStart(8)}    ${usageLeft}`
      );
    }

    if (sortedModels.length > 8) {
      addLine(
        `  ${colors.dim}... and ${sortedModels.length - 8} more models${
          colors.reset
        }`
      );
    }
  }

  addLine("");
  addLine(
    `${colors.dim}Usage limits span all sessions and reset daily.${colors.reset}`
  );
  addLine(
    `${colors.dim}» Tip: For per-account breakdown, run \`stats limits\`.${colors.reset}`
  );

  // Bottom border
  output.push(
    `${colors.dim}${box.bottomLeft}${box.horizontal.repeat(width - 2)}${
      box.bottomRight
    }${colors.reset}`
  );

  console.log(output.join("\n"));
}

/**
 * Show per-model usage statistics
 */
async function showModelStats() {
  console.log(`\n${colors.dim}Fetching model stats...${colors.reset}\n`);

  const [tokenStats, history] = await Promise.all([
    fetchFromProxy("/api/stats/tokens"),
    fetchFromProxy("/api/stats/history"),
  ]);

  // Aggregate by model
  const modelStats = {};

  for (const hourData of Object.values(history)) {
    for (const [family, familyData] of Object.entries(hourData)) {
      if (family.startsWith("_")) continue;
      for (const [model, count] of Object.entries(familyData)) {
        if (model.startsWith("_")) continue;
        const fullModel = `${family}-${model}`;
        if (!modelStats[fullModel]) {
          modelStats[fullModel] = { requests: 0, family };
        }
        modelStats[fullModel].requests += count;
      }
    }
  }

  if (Object.keys(modelStats).length === 0) {
    console.log(
      `${colors.yellow}No model usage data yet. Make some requests first!${colors.reset}\n`
    );
    return;
  }

  // Sort by request count
  const sortedModels = Object.entries(modelStats).sort(
    ([, a], [, b]) => b.requests - a.requests
  );

  // Table header
  const nameWidth = 35;
  const reqWidth = 10;

  console.log(
    `${colors.bold}${"Model".padEnd(nameWidth)}${"Requests".padStart(
      reqWidth
    )}${colors.reset}`
  );
  console.log(colors.dim + "─".repeat(nameWidth + reqWidth) + colors.reset);

  // Table rows
  for (const [model, stats] of sortedModels) {
    const familyColor =
      stats.family === "claude"
        ? colors.magenta
        : stats.family === "gemini"
        ? colors.blue
        : colors.cyan;
    console.log(
      `${familyColor}${model.padEnd(nameWidth)}${colors.reset}${formatNumber(
        stats.requests
      ).padStart(reqWidth)}`
    );
  }

  // Summary
  const totalReqs = Object.values(modelStats).reduce(
    (sum, m) => sum + m.requests,
    0
  );
  console.log(colors.dim + "─".repeat(nameWidth + reqWidth) + colors.reset);
  console.log(
    `${colors.bold}${"Total".padEnd(nameWidth)}${formatNumber(
      totalReqs
    ).padStart(reqWidth)}${colors.reset}`
  );

  // Token summary
  console.log("");
  console.log(`${colors.blue}Token Usage (Session):${colors.reset}`);
  console.log(
    `  Input: ${formatNumber(tokenStats.input || 0)}  Output: ${formatNumber(
      tokenStats.output || 0
    )}  Cached: ${formatNumber(tokenStats.cached || 0)}`
  );
  console.log("");
}

/**
 * Show account quota limits
 */
async function showLimits() {
  console.log(`\n${colors.dim}Fetching account limits...${colors.reset}\n`);

  const data = await fetchFromProxy("/account-limits");

  if (!data.accounts || data.accounts.length === 0) {
    console.log(
      `${colors.yellow}No accounts configured. Run 'antigravity-claude-proxy accounts add' first.${colors.reset}\n`
    );
    return;
  }

  for (const account of data.accounts) {
    const shortEmail = account.email.split("@")[0].slice(0, 20);
    const statusColor =
      account.status === "ok"
        ? colors.green
        : account.status === "error"
        ? colors.red
        : colors.yellow;

    console.log(
      `${colors.bold}${shortEmail}${colors.reset} ${statusColor}[${account.status}]${colors.reset}`
    );

    if (account.subscription) {
      console.log(
        `  ${colors.dim}Tier: ${account.subscription.tier || "unknown"}${
          colors.reset
        }`
      );
    }

    if (account.error) {
      console.log(`  ${colors.red}Error: ${account.error}${colors.reset}`);
      continue;
    }

    // Show model limits
    const limits = account.limits || {};
    const sortedModels = Object.entries(limits)
      .filter(([_, v]) => v !== null)
      .sort(([a], [b]) => a.localeCompare(b));

    if (sortedModels.length > 0) {
      for (const [model, quota] of sortedModels) {
        const remaining = quota.remaining || "N/A";
        const fraction = quota.remainingFraction;

        let color = colors.green;
        if (fraction !== null) {
          if (fraction === 0) color = colors.red;
          else if (fraction < 0.25) color = colors.yellow;
        }

        let resetInfo = "";
        if (quota.resetTime) {
          const resetMs = new Date(quota.resetTime).getTime() - Date.now();
          if (resetMs > 0) {
            resetInfo = ` ${colors.dim}(reset in ${formatDuration(resetMs)})${
              colors.reset
            }`;
          }
        }

        console.log(
          `  ${model.padEnd(30)} ${color}${remaining.padStart(5)}${
            colors.reset
          }${resetInfo}`
        );
      }
    }
    console.log("");
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
${colors.bold}Usage Statistics Commands${colors.reset}

${colors.cyan}USAGE:${colors.reset}
  antigravity-claude-proxy stats [command]

${colors.cyan}COMMANDS:${colors.reset}
  session     Show session summary (default)
  model       Show per-model usage breakdown
  limits      Show account quota limits

${colors.cyan}EXAMPLES:${colors.reset}
  antigravity-claude-proxy stats
  antigravity-claude-proxy stats model
  antigravity-claude-proxy stats limits
`);
}

/**
 * Main CLI handler
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "session";

  try {
    switch (command) {
      case "session":
      case "":
        await showSessionStats();
        break;

      case "model":
      case "models":
        await showModelStats();
        break;

      case "limits":
      case "quota":
      case "quotas":
        await showLimits();
        break;

      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;

      default:
        console.error(
          `${colors.red}Unknown command: ${command}${colors.reset}`
        );
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

main();
