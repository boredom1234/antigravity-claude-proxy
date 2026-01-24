# Contributor Guide

This guide outlines the development workflow, available scripts, and environment configuration for the Antigravity Claude Proxy.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm, pnpm, or yarn
- Git

### Installation

```bash
npm install
```

This will automatically build the Tailwind CSS files via the `prepare` hook.

## Development Workflow

### Start Development Server

For backend-only development (auto-restarts on file changes):

```bash
npm run dev
```

For full-stack development (backend + CSS watch):

```bash
npm run dev:full
```

### CSS Build System

The project uses Tailwind CSS with DaisyUI. Styles are defined in `public/css/src/input.css` and compiled to `public/css/style.css`.

- **Build once:** `npm run build:css`
- **Watch mode:** `npm run watch:css`

## Environment Configuration

The application can be configured via environment variables or a `config.json` file. Environment variables always take precedence.

| Environment Variable | Config Key | Description | Default |
|----------------------|------------|-------------|---------|
| `AUTH_TOKEN` | `authToken` | Token for API authentication (fallback: `apiKey`) | `""` |
| `WEBUI_PASSWORD` | `webuiPassword` | Password to protect the Web Management UI | `""` |
| `DEBUG` | `debug` | Enable verbose debug logging | `false` |
| `LOG_LEVEL` | `logLevel` | Logging level (`debug`, `info`, `warn`, `error`) | `"info"` |
| `MAX_RETRIES` | `maxRetries` | Maximum retry attempts for upstream API calls | `5` |
| `RETRY_BASE_MS` | `retryBaseMs` | Base delay for exponential backoff (ms) | `1000` |
| `RETRY_MAX_MS` | `retryMaxMs` | Maximum delay for backoff (ms) | `30000` |
| `PERSIST_TOKEN_CACHE`| `persistTokenCache`| Save OAuth tokens to disk for persistence | `false` |
| `DEFAULT_COOLDOWN_MS`| `defaultCooldownMs`| Cooldown period after hitting rate limits (ms) | `10000` |
| `MAX_WAIT_BEFORE_ERROR_MS` | `maxWaitBeforeErrorMs` | Max wait time for rate limits before returning error | `600000` |
| `GEMINI_HEADER_MODE` | `geminiHeaderMode` | Header format: `'cli'` (Gemini) or `'antigravity'` | `'cli'` |
| `MAX_CONTEXT_TOKENS` | `maxContextTokens` | Max tokens to retain in context window (0=inf) | `500000` |
| `MAX_CONCURRENT_REQUESTS` | `maxConcurrentRequests` | Max concurrent requests per account | `5` |
| `INFINITE_RETRY_MODE`| `infiniteRetryMode`| Never error on rate limits; wait indefinitely | `false` |
| `AUTO_FALLBACK` | `autoFallback` | Automatically switch models on quota exhaustion | `true` |
| `WAIT_PROGRESS_UPDATES` | `waitProgressUpdates` | Send SSE progress events while waiting | `true` |
| `AGGRESSIVE_RETRY` | `aggressiveRetry` | Retry aggressively on transient network errors | `true` |
| `DEFAULT_THINKING_LEVEL` | `defaultThinkingLevel` | Default reasoning depth (`minimal` to `high`) | `null` |
| `DEFAULT_THINKING_BUDGET` | `defaultThinkingBudget` | Default token budget for thinking blocks | `16000` |

### OAuth Configuration

| Environment Variable | Description | Default |
|----------------------|-------------|---------|
| `OAUTH_CLIENT_ID` | Google OAuth Client ID | *Internal Default* |
| `OAUTH_CLIENT_SECRET` | Google OAuth Client Secret | *Internal Default* |
| `OAUTH_CALLBACK_PORT` | Port for the local OAuth callback server | `51121` |

## Available Scripts

### General

| Script | Description |
|--------|-------------|
| `npm start` | Start the production server |
| `npm run dev` | Start server with file watching |
| `npm run dev:full` | Start server and CSS watcher concurrently |
| `npm run build:css` | Compile Tailwind CSS (minified) |
| `npm run watch:css` | Watch and compile Tailwind CSS |

### Account Management

| Script | Description |
|--------|-------------|
| `npm run accounts` | Interactive account management CLI |
| `npm run accounts:add` | Add a new Google account via OAuth |
| `npm run accounts:list` | List all configured accounts and their status |
| `npm run accounts:remove` | Remove an account from the pool |
| `npm run accounts:verify` | Verify all account tokens and project access |

### Statistics

| Script | Description |
|--------|-------------|
| `npm run stats` | View general usage statistics |
| `npm run stats:session` | View statistics broken down by session |
| `npm run stats:model` | View statistics broken down by model |
| `npm run stats:limits` | View current rate limit status for all accounts |

### Testing

| Script | Description |
|--------|-------------|
| `npm test` | Run the full test suite |
| `npm run test:signatures` | Test thinking block signature handling |
| `npm run test:multiturn` | Test multi-turn conversations with tools |
| `npm run test:streaming` | Test streaming response stability |
| `npm run test:interleaved` | Test interleaved thinking and content |
| `npm run test:images` | Test image processing and vision capabilities |
| `npm run test:caching` | Test prompt caching and token savings |
| `npm run test:crossmodel` | Test model switching mid-conversation |
| `npm run test:oauth` | Test OAuth flow in headless/no-browser mode |
| `npm run test:emptyretry` | Test retries on empty upstream responses |
| `npm run test:sanitizer` | Test JSON Schema sanitization for tool calls |

## Testing Procedures

Tests require the proxy server to be running locally on port 8672.

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Run all tests:**
   ```bash
   npm test
   ```

3. **Run specific tests:**
   ```bash
   node tests/test-thinking-signatures.cjs
   ```

All tests are located in the `tests/` directory and use the `.cjs` extension for CommonJS compatibility with the test runner.
