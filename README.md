# Concept2 Logbook MCP Server

An MCP (Model Context Protocol) server for the [Concept2 Logbook API](https://log.concept2.com/developers/documentation/). Allows Claude and other LLMs to read and manage your rowing, skiing, and biking workout data through natural language.

Built with TypeScript. Features automatic OAuth2 authentication with browser-based login, token storage, and auto-refresh.

## Quick Start

**Quick setup (token expires in 7 days):**

1. Log in to [log.concept2.com](https://log.concept2.com)
2. Go to **Profile → Applications → "Connect to Concept2 Logbook API"**
3. Copy the generated access token
4. Configure Claude Desktop with `CONCEPT2_ACCESS_TOKEN` (see below)

**Long-term setup (auto-refreshes for 1 year):**

1. Register an app at the [Concept2 Developer Portal](https://log.concept2.com/developers/keys)
2. Add `http://localhost:49721/callback` as a redirect URI
3. Configure Claude Desktop with `CLIENT_ID` and `CLIENT_SECRET`
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

**Using personal access token (simplest):**

```json
{
  "mcpServers": {
    "concept2": {
      "command": "npx",
      "args": ["mcp-concept2-logbook"],
      "env": {
        "CONCEPT2_ACCESS_TOKEN": "your_access_token"
      }
    }
  }
}
```

**Using OAuth2 flow:**

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

**For a local/source install**, replace `"command": "npx", "args": ["mcp-concept2-logbook"]` with:
```json
"command": "node",
"args": ["C:/path/to/mcp-concept2-logbook/dist/index.js"]
```

### Claude Code

```bash
# Using personal access token
claude mcp add concept2 \
  -e CONCEPT2_ACCESS_TOKEN=your_token \
  -- npx mcp-concept2-logbook

# Or using OAuth2
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
| `CONCEPT2_SCOPES` | `user:read,results:read` | OAuth2 scopes |
| `CONCEPT2_REDIRECT_PORT` | `49721` | Local port for OAuth2 callback |
| `CONCEPT2_TOKEN_FILE` | `~/.concept2_mcp_tokens.json` | Token storage path |
| `CONCEPT2_BASE_URL` | `https://log.concept2.com` | API base URL |
| `CONCEPT2_LOG_LEVEL` | `none` | Logging: `debug`, `info`, `warning`, `error`, `none` |

**Authentication methods:**
1. **Access token:** Set `ACCESS_TOKEN` - simplest, no OAuth app registration needed
2. **OAuth2 flow:** Set `CLIENT_ID` + `CLIENT_SECRET`, then use `concept2_authorize`

> If both are set, `ACCESS_TOKEN` takes priority.

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
| `concept2_get_results` | List workouts with filters (type, date range, pagination) |
| `concept2_get_result` | Get single workout details |
| `concept2_get_strokes` | Get per-stroke data for a workout |
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

**Analysis:**
- *"What's my total distance this month?"*
- *"Compare my average pace between rower and SkiErg"*

## Authentication

### Option 1: Personal Access Token (Quick setup)

The simplest method - no OAuth app registration required:

1. Log in to [log.concept2.com](https://log.concept2.com)
2. Go to **Profile → Applications**
3. Click **"Connect to Concept2 Logbook API"** to generate a token
4. Set `CONCEPT2_ACCESS_TOKEN` environment variable

> **Note:** Token expires after **7 days**. You'll need to generate a new one weekly.

### Option 2: OAuth2 Flow (Recommended for long-term use)

One-time setup, then tokens auto-refresh for up to a year:

1. Register app at [Concept2 Developer Portal](https://log.concept2.com/developers/keys)
2. Add `http://localhost:49721/callback` as redirect URI
3. Set `CONCEPT2_CLIENT_ID` and `CONCEPT2_CLIENT_SECRET`
4. Call `concept2_authorize` → opens browser to Concept2 login
5. Tokens stored in `~/.concept2_mcp_tokens.json` and auto-refresh

> Access tokens refresh automatically. Refresh tokens last **1 year**.

### Development Server

For testing against `log-dev.concept2.com`, add:
```json
"CONCEPT2_BASE_URL": "https://log-dev.concept2.com"
```

> **Note:** Development server data may be reset periodically.

## API Scopes

| Scope | Access |
|-------|--------|
| `user:read` | Read user profile |
| `results:read` | Read workout results |

Default: `user:read,results:read` (read-only access)

## Development

```bash
npm install          # Install dependencies
npm run dev          # Run with tsx (hot reload)
npm run build        # Compile TypeScript
npm start            # Run compiled output
```

## Notes

- **Redirect URI:** Only needed for OAuth2 flow. Register `http://localhost:49721/callback` in your Concept2 app.
- **Time format:** API uses tenths of seconds (e.g., `12000` = 20:00.0)
- **Distance:** Always in meters
- **Weight:** In decigrams (e.g., `7500` = 75.0 kg)

## License

MIT
