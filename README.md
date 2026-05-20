# HelpScout MCP Server

An open-source Model Context Protocol server for the Help Scout Mailbox API.

It gives MCP clients such as Claude access to Help Scout inboxes, conversations, threads, users, tags, saved replies, notes, and safe draft replies. It supports local `stdio` usage and remote Streamable HTTP usage with OAuth for Claude custom connectors.

## What It Can Do

Read tools:

- List and inspect Help Scout inboxes, folders, custom fields, users, tags, and saved replies
- Search conversations
- Fetch a conversation and its threads
- Check the authenticated Help Scout resource owner

Write tools, disabled by default:

- Create a **draft** customer reply on an existing conversation
- Create an internal note
- Patch safe conversation fields
- Replace conversation tags
- Replace conversation custom-field values

Safety defaults:

- `HELPSCOUT_MCP_ENABLE_WRITES=false` by default
- No delete tools
- No tool for sending customer replies
- No tool for creating new customer-facing conversations
- Draft replies always send `draft: true` to Help Scout

## Requirements

- Node.js 20+
- A Help Scout app using Client Credentials auth
- For remote Claude/Cowork usage: a public HTTPS URL for this server

Create a Help Scout app from the Help Scout developer portal. This server uses:

```text
grant_type=client_credentials
```

If Help Scout asks for a redirect URL while creating the app, you can use your eventual health URL, for example:

```text
https://your-domain.example.com/health
```

The redirect URL is not used by the Help Scout client-credentials flow.

## Install

```bash
git clone https://github.com/samiabid/helpscout-mcp-server.git
cd helpscout-mcp-server
npm install
cp .env.example .env
npm run build
```

Set the required Help Scout variables:

```bash
HELPSCOUT_APP_ID=your_help_scout_app_id
HELPSCOUT_APP_SECRET=your_help_scout_app_secret
```

Useful optional variables:

```bash
HELPSCOUT_API_BASE_URL=https://api.helpscout.net/v2
HELPSCOUT_MCP_ENABLE_WRITES=false
HELPSCOUT_MCP_LOG_LEVEL=info
```

## Local Stdio MCP

Use stdio when your MCP client runs the server as a local process.

```bash
npm run start:stdio
```

Example local MCP config:

```json
{
  "mcpServers": {
    "helpscout": {
      "command": "node",
      "args": ["/absolute/path/to/helpscout-mcp-server/dist/stdio.js"],
      "env": {
        "HELPSCOUT_APP_ID": "your_help_scout_app_id",
        "HELPSCOUT_APP_SECRET": "your_help_scout_app_secret",
        "HELPSCOUT_MCP_ENABLE_WRITES": "false"
      }
    }
  }
}
```

## Remote HTTP MCP

Use Streamable HTTP when hosting this server in the cloud.

For a simple private HTTP deployment, use a static bearer token:

```bash
HELPSCOUT_MCP_HTTP_TOKEN="$(openssl rand -hex 32)" npm run start:http
```

The MCP endpoint is:

```text
http://127.0.0.1:3344/mcp
```

Requests must include:

```http
Authorization: Bearer <HELPSCOUT_MCP_HTTP_TOKEN>
```

Health checks do not require auth:

```text
GET /health
```

## Claude Cowork And Claude Custom Connectors

Claude-hosted custom connectors connect to a remote MCP server from Anthropic's cloud infrastructure. For Claude.ai, Claude Desktop custom connectors, and Claude Cowork, use OAuth mode.

Set these variables in your cloud host:

```bash
HELPSCOUT_MCP_OAUTH_ENABLED=true
HELPSCOUT_MCP_PUBLIC_URL=https://your-public-host.example.com
HELPSCOUT_MCP_OAUTH_SECRET=<long-random-signing-secret>
HELPSCOUT_MCP_OAUTH_PASSWORD=<password-you-enter-on-the-consent-page>
```

Generate good values:

```bash
openssl rand -hex 32 # HELPSCOUT_MCP_OAUTH_SECRET
openssl rand -hex 16 # HELPSCOUT_MCP_OAUTH_PASSWORD
```

Claude connector URL:

```text
https://your-public-host.example.com/mcp
```

Claude OAuth callback URL:

```text
https://claude.ai/api/mcp/auth_callback
```

Typical Claude/Cowork setup:

1. Deploy this server to a public HTTPS host.
2. Confirm `GET /health` returns `ok: true`.
3. In Claude, open **Settings / Customize → Connectors**.
4. Add a custom connector.
5. Enter the MCP URL:
   ```text
   https://your-public-host.example.com/mcp
   ```
6. Leave OAuth client ID and client secret blank if Claude shows those advanced fields.
7. Complete the authorization popup using `HELPSCOUT_MCP_OAUTH_PASSWORD`.
8. In a new Claude chat, ask it to list Help Scout inboxes or search conversations.

If you later enable writes, disconnect and reconnect the connector so Claude receives the updated `helpscout:write` scope.

## Railway Deployment

This repo is Railway/Nixpacks friendly:

- `npm run build` compiles TypeScript to `dist/`
- `npm start` runs `node dist/http.js`
- Railway's `PORT` is used automatically
- Railway defaults the HTTP host to `0.0.0.0`

Example:

```bash
railway init -n helpscout-mcp-server
railway add --service helpscout-mcp-server
railway variable set -s helpscout-mcp-server -e production \
  "HELPSCOUT_APP_ID=your_help_scout_app_id" \
  "HELPSCOUT_APP_SECRET=your_help_scout_app_secret" \
  "HELPSCOUT_MCP_ENABLE_WRITES=false" \
  "HELPSCOUT_MCP_OAUTH_ENABLED=true" \
  "HELPSCOUT_MCP_PUBLIC_URL=https://your-railway-domain.up.railway.app" \
  "HELPSCOUT_MCP_OAUTH_SECRET=$(openssl rand -hex 32)" \
  "HELPSCOUT_MCP_OAUTH_PASSWORD=$(openssl rand -hex 16)"
railway up -s helpscout-mcp-server -e production --detach
railway domain -s helpscout-mcp-server
```

After Railway gives you a domain, make sure `HELPSCOUT_MCP_PUBLIC_URL` exactly matches it and redeploy if needed.

## Writes

Writes are disabled unless:

```bash
HELPSCOUT_MCP_ENABLE_WRITES=true
```

When writes are disabled, write tools return a `WritesDisabled` MCP error before making any Help Scout request.

When writes are enabled, the exposed write tools are:

- `helpscout_create_draft_reply`
- `helpscout_create_note`
- `helpscout_patch_conversation`
- `helpscout_set_conversation_tags`
- `helpscout_update_custom_fields`

`helpscout_create_draft_reply` always sends `draft: true`; this server does not expose a send-reply tool.

## Development

```bash
npm run dev:stdio
npm run dev:http
npm run typecheck
npm run build
npm test
```

Mocked tests are the default and do not require Help Scout credentials.

Live read smoke tests are opt-in:

```bash
HELPSCOUT_RUN_LIVE_TESTS=true npm run test:live
```

Live write checks are separately gated:

```bash
HELPSCOUT_RUN_LIVE_TESTS=true \
HELPSCOUT_RUN_LIVE_WRITE_TESTS=true \
HELPSCOUT_LIVE_MAILBOX_ID=123 \
HELPSCOUT_LIVE_CUSTOMER_EMAIL=test@example.com \
npm run test:live
```

## API Notes

- Help Scout API base URL: `https://api.helpscout.net/v2`
- Help Scout token endpoint: `POST /v2/oauth2/token`
- Access tokens are cached in memory until expiry minus a safety buffer
- The client retries once after a `401` by fetching a fresh token
- HAL pagination helpers follow `_links.next.href`
- `429` responses use `X-RateLimit-Retry-After` or `Retry-After` when retrying

## Security

- Do not commit `.env` files or Help Scout credentials.
- Use a long random `HELPSCOUT_MCP_OAUTH_SECRET`.
- Use a separate random `HELPSCOUT_MCP_OAUTH_PASSWORD`.
- Keep writes off unless you explicitly need draft/note/tag/custom-field mutation.
- Rotate credentials if they are ever pasted into logs, issues, screenshots, or chats.
- OAuth mode defaults to Dynamic Client Registration. Client ID Metadata Documents are disabled unless `HELPSCOUT_MCP_OAUTH_ENABLE_CIMD=true`.
- Do not set `HELPSCOUT_MCP_ALLOW_STATIC_TOKEN_WITH_OAUTH=true` unless you intentionally need the legacy bearer-token path alongside OAuth.

## References

- Help Scout Mailbox API: https://developer.helpscout.com/mailbox-api/
- Help Scout authentication: https://developer.helpscout.com/mailbox-api/overview/authentication/
- Help Scout rate limiting: https://developer.helpscout.com/mailbox-api/overview/rate-limiting/
- Model Context Protocol TypeScript SDK: https://modelcontextprotocol.io/docs/sdk
- Claude connector authentication: https://claude.com/docs/connectors/building/authentication
- Claude custom connectors help: https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp
