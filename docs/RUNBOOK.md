# Runbook

This runbook details operational procedures, deployment, monitoring, and troubleshooting for the Antigravity Claude Proxy.

## Deployment

### Requirements

- **OS**: Linux, macOS, or Windows
- **Runtime**: Node.js >= 18.0.0
- **Storage**: ~50MB for application + SQLite database
- **Network**: Port 8672 (default) must be accessible by your Claude CLI or client.

### Starting the Service

The proxy can be started with several flags to modify behavior:

| Command | Description |
|---------|-------------|
| `npm start` | Standard start on port 8672 |
| `npm start -- --fallback` | Start with automatic model fallback enabled |
| `npm start -- --debug` | Start with verbose debug logging enabled |
| `PORT=9000 npm start` | Start on a custom port |

### Configuration Precedence

The proxy loads configuration in the following order (later stages override earlier ones):
1. **Hardcoded Defaults**: Defined in `src/config.js`.
2. **File Config**: `~/.config/antigravity-proxy/config.json` (or `./config.json` in project root).
3. **Environment Variables**: e.g., `AUTH_TOKEN`, `WEBUI_PASSWORD`.
4. **CLI Flags**: `--debug`, `--fallback`.

## Monitoring

### Web Dashboard

Access the management interface at `http://localhost:8672` (or your configured port).

- **Dashboard**: Real-time stats on request volume and model distribution.
- **Accounts**: Monitor quota usage (`remainingFraction`), subscription tiers (Ultra/Pro/Free), and account validity.
- **Logs**: Live stream of server logs via SSE.
- **Settings**: Hot-reloadable configuration for the proxy and Claude CLI.

### Health Checks

The proxy provides a health endpoint:
- **URL**: `http://localhost:8672/health`
- **Response**: `{"status":"ok","version":"1.2.6"}`

## Operational Procedures

### Account Management

**Adding Accounts**:
- **WebUI**: Click "Add Account" and follow the OAuth popup.
- **CLI**: Run `npm run accounts:add`. Use `--no-browser` if running on a headless server.

**Verifying Status**:
Run `npm run accounts:verify` to check if all refresh tokens are still valid and projects are accessible.

### Handling Rate Limits

The proxy implements several strategies to mitigate rate limits:
1. **Sticky Sessions**: Keeps a conversation on the same account as long as possible to maximize prompt caching.
2. **Quota Balancing**: Automatically switches accounts if the current one falls below 10% remaining quota.
3. **Model Fallback**: If all accounts are exhausted for `claude-3-5-sonnet`, it can automatically switch to `claude-3-5-haiku` (if `--fallback` is used).
4. **Wait Queuing**: If `INFINITE_RETRY_MODE` is enabled, requests will hang and wait for the next available quota reset instead of erroring.

## Common Issues & Troubleshooting

### 1. Native Module Mismatch (SQLite)

**Symptom**: `Error: The module 'better-sqlite3.node' was compiled against a different Node.js version`.

**Resolution**:
The proxy includes a `native-module-helper` that attempts to auto-rebuild on startup. If this fails:
1. Ensure `python` and `build-essential` (Linux) or `Visual Studio Build Tools` (Windows) are installed.
2. Run `npm rebuild better-sqlite3`.
3. If still failing, delete `node_modules` and run `npm install`.

### 2. OAuth "Invalid Grant"

**Symptom**: Accounts marked as `invalid` with "Invalid Grant" reason.

**Resolution**:
This usually happens if the refresh token was revoked or expired.
1. Remove the account: `npm run accounts:remove`.
2. Re-add the account: `npm run accounts:add`.

### 3. High Latency in Streaming

**Symptom**: "Thinking" blocks take a long time to appear or the connection drops.

**Resolution**:
- Check if the account is being rate-limited (logs will show "Rate limit reached, waiting...").
- Increase `MAX_WAIT_BEFORE_ERROR_MS` if your accounts have low RPM.
- Verify network connectivity to `*.googleapis.com`.

### 4. Port 8672 Already in Use

**Symptom**: `Error: listen EADDRINUSE: address already in use :::8672`.

**Resolution**:
- Identify the process: `lsof -i :8672` (Mac/Linux) or `netstat -ano | findstr :8672` (Windows).
- Kill the process or change the port using the `PORT` environment variable.

## Rollback Procedure

If a deployment causes instability:
1. Stop the process.
2. Revert to previous version: `git checkout v1.2.5` (or previous stable commit).
3. Clean and reinstall: `rm -rf node_modules && npm install`.
4. Restart: `npm start`.
