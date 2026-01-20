# Antigravity Claude Proxy

[![npm version](https://img.shields.io/npm/v/antigravity-claude-proxy.svg)](https://www.npmjs.com/package/antigravity-claude-proxy)
[![npm downloads](https://img.shields.io/npm/dm/antigravity-claude-proxy.svg)](https://www.npmjs.com/package/antigravity-claude-proxy)

A proxy server that exposes an **Anthropic-compatible API** backed by **Antigravity's Cloud Code**, letting you use Claude and Gemini models with **Claude Code CLI**.

![Antigravity Claude Proxy Banner](images/banner.png)

## Documentation

- [**Contributor Guide**](docs/CONTRIB.md) - Development workflow, scripts, and environment setup.
- [**Runbook**](docs/RUNBOOK.md) - Operational procedures, deployment, monitoring, and troubleshooting.
- [**CLAUDE.md**](CLAUDE.md) - Project architecture and coding guidelines.

## How It Works

```
┌──────────────────┐     ┌─────────────────────┐     ┌────────────────────────────┐
│   Claude Code    │────▶│  This Proxy Server  │────▶│  Antigravity Cloud Code    │
│   (Anthropic     │     │  (Anthropic → Google│     │  (daily-cloudcode-pa.      │
│    API format)   │     │   Generative AI)    │     │   sandbox.googleapis.com)  │
└──────────────────┘     └─────────────────────┘     └────────────────────────────┘
```

1. Receives requests in **Anthropic Messages API format**
2. Uses OAuth tokens from added Google accounts
3. Transforms to **Google Generative AI format** with Cloud Code wrapping
4. Sends to Antigravity's Cloud Code API
5. Converts responses back to **Anthropic format** with full thinking/streaming support

## Prerequisites

- **Node.js** 18 or later
- **Antigravity** installed (for single-account mode) OR Google account(s) for multi-account mode

---

## Installation

### Option 1: npm (Recommended)

```bash
# Run directly with npx (no install needed)
npx antigravity-claude-proxy@latest start

# Or install globally
npm install -g antigravity-claude-proxy@latest
antigravity-claude-proxy start
```

### Option 2: Clone Repository

```bash
git clone https://github.com/boredom1234/antigravity-claude-proxy.git
cd antigravity-claude-proxy
npm install
npm start
```

---

## Quick Start

### 1. Start the Proxy Server

```bash
antigravity-claude-proxy start
```

The server runs on `http://localhost:8672` by default.

### 2. Link Account(s)

#### **Method A: Web Dashboard (Recommended)**
1. Open `http://localhost:8672` in your browser.
2. Navigate to **Accounts** tab and click **Add Account**.
3. Complete Google OAuth authorization.

#### **Method B: CLI**
```bash
antigravity-claude-proxy accounts add
```

### 3. Verify It's Working

```bash
curl http://localhost:8672/health
```

---

## Using with Claude Code CLI

### Configure Claude Code

You can configure these settings in two ways:

#### **Via Web Console (Recommended)**

1. Open the WebUI at `http://localhost:8672`.
2. Go to **Settings** → **Claude CLI**.
3. Select your preferred models and click **Apply to Claude CLI**.

#### **Manual Configuration**

Add this to your `~/.claude/settings.json` (macOS/Linux) or `%USERPROFILE%\.claude\settings.json` (Windows):

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "test",
    "ANTHROPIC_BASE_URL": "http://localhost:8672",
    "ANTHROPIC_MODEL": "claude-opus-4-5-thinking",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-5-thinking",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5-thinking",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gemini-2.5-flash-lite[1m]",
    "CLAUDE_CODE_SUBAGENT_MODEL": "claude-sonnet-4-5-thinking",
    "ENABLE_EXPERIMENTAL_MCP_CLI": "true"
  }
}
```

### Run Claude Code

```bash
# In another terminal
claude
```

> **Note:** If asked to login, add `"hasCompletedOnboarding": true` to `~/.claude.json`.

---

## Available Models

| Model ID | Family | Description |
|----------|--------|-------------|
| `claude-sonnet-4-5-thinking` | Claude | Sonnet 4.5 with extended thinking |
| `claude-opus-4-5-thinking` | Claude | Opus 4.5 with extended thinking |
| `gemini-3-flash` | Gemini | Gemini 3 Flash with thinking |
| `gemini-3-pro-high` | Gemini | Gemini 3 Pro High with thinking |
| `gpt-oss-120b-medium` | GPT | GPT-OSS 120B Medium |

See [Web Console](http://localhost:8672) for full list and quotas.

---

## Features

- **Multi-Account Load Balancing**: Automatically switches accounts when rate limits are hit.
- **Smart Rate Limiting**: Queues or fails over based on strategy.
- **Web Management Console**: Real-time monitoring, account management, and logs at `http://localhost:8672`.
- **Model Fallback**: Automatically downgrades model on exhaustion (enable with `--fallback`).

## Configuration & Development

For detailed configuration options (environment variables) and development scripts, see the [Contributor Guide](docs/CONTRIB.md).

For operational procedures, troubleshooting, and deployment, see the [Runbook](docs/RUNBOOK.md).

---

## Legal

- **Not affiliated with Google or Anthropic.**
- "Antigravity", "Gemini", "Google Cloud", and "Google" are trademarks of Google LLC.
- "Claude" and "Anthropic" are trademarks of Anthropic PBC.
- Software is provided "as is", without warranty.

---

## Credits

- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth)
- [claude-code-proxy](https://github.com/1rgs/claude-code-proxy)
