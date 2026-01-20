# Contributor Guide

This guide outlines the development workflow, available scripts, and environment configuration for the Antigravity Claude Proxy.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

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

The project uses Tailwind CSS. Styles are defined in `public/css/src/input.css` and compiled to `public/css/style.css`.

- **Build once:** `npm run build:css`
- **Watch mode:** `npm run watch:css`

## Environment Configuration

The application can be configured via `config.json` in `~/.config/antigravity-proxy/` or via environment variables.

| Environment Variable | Config Key | Description | Default |
|----------------------|------------|-------------|---------|
| `AUTH_TOKEN` | `authToken` | API authentication token | `""` |
| `WEBUI_PASSWORD` | `webuiPassword` | Password for the Web Management UI | `""` |
| `DEBUG` | `debug` | Enable debug logging | `false` |
| `LOG_LEVEL` | `logLevel` | Logging level (`debug`, `info`, `warn`, `error`) | `"info"` |
| `MAX_RETRIES` | `maxRetries` | Maximum retry attempts for API calls | `5` |
| `RETRY_BASE_MS` | `retryBaseMs` | Base delay for exponential backoff (ms) | `1000` |
| `RETRY_MAX_MS` | `retryMaxMs` | Maximum delay for backoff (ms) | `30000` |
| `PERSIST_TOKEN_CACHE`| `persistTokenCache`| Save auth tokens to disk | `false` |
| `DEFAULT_COOLDOWN_MS`| `defaultCooldownMs`| Cooldown period after rate limits (ms) | `10000` |
| `MAX_WAIT_BEFORE_ERROR_MS` | `maxWaitBeforeErrorMs` | Max wait time for rate limits before erroring | `600000` |
| `GEMINI_HEADER_MODE` | `geminiHeaderMode` | Header mode: `'cli'` or `'antigravity'` | `'cli'` |
| `MAX_CONTEXT_TOKENS` | `maxContextTokens` | Max tokens for context window | `500000` |
| `MAX_CONCURRENT_REQUESTS` | `maxConcurrentRequests` | Max concurrent requests per account | `5` |
| `INFINITE_RETRY_MODE`| `infiniteRetryMode`| Never give up on rate limits | `false` |
| `AUTO_FALLBACK` | `autoFallback` | Automatically switch models on failure | `true` |
| `WAIT_PROGRESS_UPDATES` | `waitProgressUpdates` | Send SSE progress events while waiting | `true` |
| `AGGRESSIVE_RETRY` | `aggressiveRetry` | Retry more aggressively on transient errors | `true` |

### OAuth Configuration

| Environment Variable | Description |
|----------------------|-------------|
| `OAUTH_CLIENT_ID` | Google OAuth Client ID |
| `OAUTH_CLIENT_SECRET` | Google OAuth Client Secret |
| `OAUTH_CALLBACK_PORT` | Port for OAuth callback (default: 51121) |

## Available Scripts

### General

| Script | Description |
|--------|-------------|
| `npm start` | node src/index.js |
| `npm run dev` | node --watch src/index.js |
| `npm run dev:full` | concurrently "npm run watch:css" "npm run dev" |
| `npm run build:css` | tailwindcss -i ./public/css/src/input.css -o ./public/css/style.css --minify |
| `npm run watch:css` | tailwindcss -i ./public/css/src/input.css -o ./public/css/style.css --watch |

### Account Management

| Script | Description |
|--------|-------------|
| `npm run accounts` | node src/cli/accounts.js |
| `npm run accounts:add` | node src/cli/accounts.js add |
| `npm run accounts:list` | node src/cli/accounts.js list |
| `npm run accounts:remove` | node src/cli/accounts.js remove |
| `npm run accounts:verify` | node src/cli/accounts.js verify |

### Stats

| Script | Description |
|--------|-------------|
| `npm run stats` | node src/cli/stats.js |
| `npm run stats:session` | node src/cli/stats.js session |
| `npm run stats:model` | node src/cli/stats.js model |
| `npm run stats:limits` | node src/cli/stats.js limits |

### Testing

| Script | Description |
|--------|-------------|
| `npm test` | node tests/run-all.cjs |
| `npm run test:signatures` | node tests/test-thinking-signatures.cjs |
| `npm run test:multiturn` | node tests/test-multiturn-thinking-tools.cjs |
| `npm run test:streaming` | node tests/test-multiturn-thinking-tools-streaming.cjs |
| `npm run test:interleaved` | node tests/test-interleaved-thinking.cjs |
| `npm run test:images` | node tests/test-images.cjs |
| `npm run test:caching` | node tests/test-caching-streaming.cjs |
| `npm run test:crossmodel` | node tests/test-cross-model-thinking.cjs |
| `npm run test:oauth` | node tests/test-oauth-no-browser.cjs |
| `npm run test:emptyretry` | node tests/test-empty-response-retry.cjs |
| `npm run test:sanitizer` | node tests/test-schema-sanitizer.cjs |

## Testing Procedures

Tests assume the server is running on port 8672.

1. Start the server:
   ```bash
   npm start
   ```

2. Run tests in a separate terminal:
   ```bash
   npm test
   ```
