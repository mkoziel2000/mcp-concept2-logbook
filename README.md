# Concept2 Logbook MCP Server

An MCP (Model Context Protocol) server for the [Concept2 Logbook API](https://log.concept2.com/developers/documentation/). Allows Claude and other LLMs to read and manage your rowing, skiing, and biking workout data through natural language.

Built with TypeScript. Features automatic OAuth2 authentication with browser-based login, token storage, and auto-refresh.

## Quick Start

1. Get API credentials from the [Concept2 Developer Portal](https://log.concept2.com/developers/keys)
2. Add `http://localhost:49721/callback` as a redirect URI in your Concept2 app settings
3. Configure Claude Desktop (see below)
4. Ask Claude: *"Connect to my Concept2 account"*

## Installation

### From npm

```bash
npx mcp-concept2-logbook
```

### From Source

```bash
git clone https://github.com/yourusername/mcp-concept2-logbook.git
cd mcp-concept2-logbook
npm install
npm run build
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "concept2": {
      "command": "npx",
      "args": ["mcp-concept2-logbook"],
      "env": {
        "CONCEPT2_CLIENT_ID": "your_client_id",
        "CONCEPT2_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

For a local/source install, use:

```json
{
  "mcpServers": {
    "concept2": {
      "command": "node",
      "args": ["C:/path/to/mcp-concept2-logbook/dist/index.js"],
      "env": {
        "CONCEPT2_CLIENT_ID": "your_client_id",
        "CONCEPT2_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add concept2 \
  -e CONCEPT2_CLIENT_ID=your_id \
  -e CONCEPT2_CLIENT_SECRET=your_secret \
  -- npx mcp-concept2-logbook
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONCEPT2_CLIENT_ID` | — | OAuth2 Client ID (for OAuth flow) |
| `CONCEPT2_CLIENT_SECRET` | — | OAuth2 Client Secret (for OAuth flow) |
| `CONCEPT2_ACCESS_TOKEN` | — | Static access token (for dev/testing) |
| `CONCEPT2_SCOPES` | `user:read,results:write` | OAuth2 scopes |
| `CONCEPT2_REDIRECT_PORT` | `49721` | Local port for OAuth2 callback |
| `CONCEPT2_TOKEN_FILE` | `~/.concept2_mcp_tokens.json` | Token storage path |
| `CONCEPT2_BASE_URL` | `https://log.concept2.com` | API base URL |

**Authentication priority:**
1. **Static token:** If `ACCESS_TOKEN` is set, it's used for all requests (dev/test mode)
2. **OAuth2 flow:** Otherwise, use `CLIENT_ID` + `CLIENT_SECRET` with `concept2_authorize`

> If `ACCESS_TOKEN` is present, OAuth credentials are ignored.

## Tools

### Authentication

| Tool | Description |
|------|-------------|
| `concept2_authorize` | Open browser to log in and authorize access |
| `concept2_auth_status` | Check connection status and token expiry |
| `concept2_logout` | Disconnect and clear stored tokens |

### Profile & Workouts

| Tool | Description |
|------|-------------|
| `concept2_get_user` | Get user profile (name, country, weight, max HR) |
| `concept2_edit_user` | Update profile settings |
| `concept2_get_results` | List workouts with filters (type, date range, pagination) |
| `concept2_get_result` | Get single workout details |
| `concept2_add_result` | Log a new workout |
| `concept2_edit_result` | Edit workout (comments, weight class, privacy) |
| `concept2_delete_result` | Delete a workout |
| `concept2_get_strokes` | Get per-stroke data for a workout |
| `concept2_delete_strokes` | Delete stroke data |
| `concept2_workout_summary` | Aggregate stats across workouts |

### Challenges (no auth required)

| Tool | Description |
|------|-------------|
| `concept2_get_challenges` | List challenges (current, upcoming, by season) |
| `concept2_get_events` | List events for a calendar year |

## Usage Examples

**Getting started:**
- *"Connect to my Concept2 account"*
- *"Check my Concept2 auth status"*

**Viewing data:**
- *"Show my Concept2 profile"*
- *"List my last 10 rowing workouts"*
- *"Show my workout summary for January 2025"*
- *"Get stroke data for workout #12345"*
- *"What challenges are running right now?"*

**Logging workouts:**
- *"Log a 5000m row, time 20:15.0, stroke rate 28, drag 120"*
- *"Add a 30 minute SkiErg session, 7500m"*

**Analysis:**
- *"What's my total distance this month?"*
- *"Compare my average pace between rower and SkiErg"*

## Authentication

### Option 1: OAuth2 Flow (Production)

1. Call `concept2_authorize` → opens browser to Concept2 login
2. User approves → callback received on `localhost:49721/callback`
3. Tokens stored in `~/.concept2_mcp_tokens.json`
4. Tokens auto-refresh before expiry

### Option 2: Static Token (Development)

For development and testing against `log-dev.concept2.com`:

1. Get an access token from the [Concept2 Dev Portal](https://log-dev.concept2.com/developers/keys)
2. Set `CONCEPT2_ACCESS_TOKEN` environment variable
3. Optionally set `CONCEPT2_BASE_URL=https://log-dev.concept2.com`

```json
{
  "mcpServers": {
    "concept2-dev": {
      "command": "node",
      "args": ["C:/path/to/mcp-concept2-logbook/dist/index.js"],
      "env": {
        "CONCEPT2_ACCESS_TOKEN": "your_dev_access_token",
        "CONCEPT2_BASE_URL": "https://log-dev.concept2.com"
      }
    }
  }
}
```

This bypasses the OAuth flow entirely — useful for testing API calls before implementing the full OAuth integration.

> **Note:** Development server data may be reset periodically. Don't rely on data persisting there.

## API Scopes

| Scope | Access |
|-------|--------|
| `user:read` | Read user profile |
| `user:write` | Read + write user profile |
| `results:read` | Read workout results |
| `results:write` | Read + write workout results |

Default: `user:read,results:write`

## Development

```bash
npm install          # Install dependencies
npm run dev          # Run with tsx (hot reload)
npm run build        # Compile TypeScript
npm start            # Run compiled output
```

## Notes

- **Redirect URI:** Register `http://localhost:49721/callback` in your Concept2 app settings
- **Development server:** Concept2 requires initial development against `log-dev.concept2.com`. Use `CONCEPT2_ACCESS_TOKEN` for quick testing, or full OAuth with `CLIENT_ID`/`CLIENT_SECRET`. Contact `ranking@concept2.com` for production approval.
- **Time format:** API uses tenths of seconds (e.g., `12000` = 20:00.0)
- **Distance:** Always in meters
- **Weight:** In decigrams (e.g., `7500` = 75.0 kg)

## License

MIT
