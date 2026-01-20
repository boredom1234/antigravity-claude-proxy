# Runbook

This runbook details operational procedures, deployment, monitoring, and troubleshooting for the Antigravity Claude Proxy.

## Deployment

### Requirements

- **OS**: Linux, macOS, or Windows
- **Runtime**: Node.js >= 18.0.0
- **Network**: Port 8672 (default) open for incoming traffic from Claude CLI

### Starting the Service

Standard start:
```bash
npm start
```

With model fallback enabled (recommended for high availability):
```bash
npm start -- --fallback
```

With debug logging:
```bash
npm start -- --debug
```

### Docker (Optional)

If a Dockerfile is present/added:
```bash
docker build -t antigravity-proxy .
docker run -p 8672:8672 -v ~/.config/antigravity-proxy:/root/.config/antigravity-proxy antigravity-proxy
```

## Monitoring

### Web Dashboard

The service includes a built-in Web UI for monitoring status, accounts, and logs.

- **URL**: `http://localhost:8672`
- **Features**:
  - Real-time request logging
  - Account quota usage and subscription tiers
  - Active model configuration
  - System health status

### Logs

Logs are output to stdout/stderr.

- **Info**: Normal operation, request summaries.
- **Warn**: Rate limits, temporary failures, fallback triggers.
- **Error**: Critical failures, authentication errors, configuration issues.

To view logs in real-time via CLI:
```bash
npm start | grep -v "Heartbeat"
```

## Operational Procedures

### Adding Accounts

1. Navigate to the Web UI Accounts tab, OR
2. Run the CLI command:
   ```bash
   npm run accounts:add
   ```
3. Follow the OAuth flow in the browser.

### Rotating Secrets

If `OAUTH_CLIENT_SECRET` or `WEBUI_PASSWORD` needs rotation:
1. Update the environment variables or `.env` file.
2. Restart the service.

### Handling Rate Limits

The proxy handles rate limits automatically by:
1. Identifying the specific model limit reached.
2. Checking other configured accounts for available quota.
3. Switching to a fallback model if configured (`--fallback`).
4. Queuing requests if `INFINITE_RETRY_MODE` is enabled.

**Manual Intervention**:
- Add more accounts via `npm run accounts:add`.
- Enable fallback models if not already active.

## Common Issues & Troubleshooting

### 1. Build Failures (Native Modules)

**Symptom**: `better-sqlite3` or other native modules fail to load after Node.js update.
**Fix**:
The proxy has an auto-rebuild feature. If that fails:
```bash
rm -rf node_modules
npm install
```

### 2. OAuth Authentication Failures

**Symptom**: "Invalid Grant" or "Token Expired" errors in logs.
**Fix**:
- Run `npm run accounts:verify` to check status.
- Remove invalid accounts: `npm run accounts:remove`.
- Re-add the account to generate new refresh tokens.

### 3. "Model Not Found" or "404"

**Symptom**: API returns 404 for a specific model.
**Fix**:
- Verify the model name is correct in `src/constants.js`.
- Check if the account has access to the model (Tier restrictions).
- Verify `GEMINI_HEADER_MODE` matches the target environment (`cli` vs `antigravity`).

### 4. High Latency / Stalls

**Symptom**: Requests hang for long periods.
**Fix**:
- Check `MAX_WAIT_BEFORE_ERROR_MS` configuration.
- Check if `INFINITE_RETRY_MODE` is enabled (requests may queue indefinitely).
- Check network connectivity to `googleapis.com`.

## Rollback Procedure

If a new deployment fails:
1. Stop the current process (`Ctrl+C`).
2. Checkout the previous stable git tag/commit.
3. Run `npm install` to restore dependencies.
4. Start the service: `npm start`.
