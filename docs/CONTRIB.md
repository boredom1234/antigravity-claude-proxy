# Contributor Guide

This guide outlines the development workflow, available scripts, and environment configuration for the Antigravity Claude Proxy project.

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
| `npm start` | Start the production server |
| `npm run dev` | Start development server with file watching |
| `npm run dev:full` | Start development server + CSS watcher |
| `npm run build:css` | Build minified CSS |
| `npm run watch:css` | Watch CSS for changes |

### Account Management

| Script | Description |
|--------|-------------|
| `npm run accounts` | Interactive account management CLI |
| `npm run accounts:add` | Add a new Google account |
| `npm run accounts:list` | List configured accounts |
| `npm run accounts:remove` | Remove an account |
| `npm run accounts:verify` | Verify account tokens |

### Stats

| Script | Description |
|--------|-------------|
| `npm run stats` | View general usage statistics |
| `npm run stats:session` | View session-specific stats |
| `npm run stats:model` | View model usage stats |
| `npm run stats:limits` | View rate limit stats |

### Testing

| Script | Description |
|--------|-------------|
| `npm test` | Run all tests |
| `npm run test:signatures` | Test thinking signature handling |
| `npm run test:multiturn` | Test multi-turn conversations |
| `npm run test:streaming` | Test streaming SSE events |
| `npm run test:interleaved` | Test interleaved thinking blocks |
| `npm run test:images` | Test image processing |
| `npm run test:caching` | Test prompt caching |
| `npm run test:crossmodel` | Test cross-model thinking (Claude <-> Gemini) |
| `npm run test:oauth` | Test OAuth flow (no-browser mode) |
| `npm run test:emptyretry` | Test retry logic for empty responses |
| `npm run test:sanitizer` | Test JSON schema sanitization |

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
