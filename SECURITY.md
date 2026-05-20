# Security

Please do not report vulnerabilities in public issues.

For now, contact the maintainer privately with:

- A short description of the issue
- Impact and affected configuration
- Reproduction steps if available

Operational guidance:

- Never commit Help Scout app IDs, app secrets, `.env` files, OAuth secrets, or connector passwords.
- Keep `HELPSCOUT_MCP_ENABLE_WRITES=false` unless write tools are explicitly needed.
- Rotate Help Scout and MCP OAuth credentials if they are exposed in logs, screenshots, issues, or chats.
- Keep Client ID Metadata Documents disabled unless your MCP client requires them. Dynamic Client Registration is the safer default.
- Avoid enabling the static HTTP bearer-token fallback when OAuth mode is enabled.
