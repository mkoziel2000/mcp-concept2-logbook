#!/usr/bin/env node
/**
 * Concept2 Logbook MCP Server
 *
 * An MCP server that integrates with the Concept2 Logbook API, providing tools
 * for managing user profiles, workout results, stroke data, and challenges.
 *
 * Supports automatic OAuth2 authentication. Set CONCEPT2_CLIENT_ID and
 * CONCEPT2_CLIENT_SECRET environment variables to enable automatic token
 * management with browser-based authorization flow.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  tokenManager,
  CLIENT_ID,
  CLIENT_SECRET,
  TOKEN_FILE,
  REDIRECT_PORT,
  STATIC_ACCESS_TOKEN,
  IS_DEV_SERVER,
  BASE_URL,
  LOG_LEVEL,
} from "./oauth.js";

import {
  apiGet,
  formatTime,
  formatUserMarkdown,
  formatResultMarkdown,
  formatChallengeMarkdown,
  type ApiResponse,
  type User,
  type Result,
  type Challenge,
  type Stroke,
} from "./api.js";

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  // OAuth2 Tools
  {
    name: "concept2_authorize",
    description:
      "Initiate OAuth2 authorization flow to connect to your Concept2 Logbook account. Opens a browser window for login.",
    inputSchema: {
      type: "object",
      properties: {
        open_browser: {
          type: "boolean",
          description: "Automatically open the authorization URL in the default browser.",
          default: true,
        },
      },
    },
  },
  {
    name: "concept2_auth_status",
    description: "Check the current OAuth2 authorization status, token expiry, and configuration.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "concept2_logout",
    description: "Remove stored OAuth2 tokens and disconnect from Concept2 Logbook.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // User Profile Tools
  {
    name: "concept2_get_user",
    description:
      "Fetch a Concept2 logbook user profile by ID or 'me' for the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        user: {
          type: "string",
          description: "User ID (integer) or 'me' for the authenticated user.",
          default: "me",
        },
        response_format: {
          type: "string",
          enum: ["markdown", "json"],
          description: "Output format.",
          default: "markdown",
        },
      },
    },
  },
  // Results Tools
  {
    name: "concept2_get_results",
    description: "List workout results from the Concept2 logbook with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        user: { type: "string", default: "me" },
        type: {
          type: "string",
          enum: ["rower", "skierg", "bike", "dynamic", "slides", "paddle", "water", "snow", "rollerski", "multierg"],
        },
        from_date: { type: "string", description: "Start date (YYYY-MM-DD)." },
        to_date: { type: "string", description: "End date (YYYY-MM-DD)." },
        updated_after: { type: "string", description: "Only results updated after this date." },
        page: { type: "integer", minimum: 1, default: 1 },
        per_page: { type: "integer", minimum: 1, maximum: 250, default: 50 },
        response_format: { type: "string", enum: ["markdown", "json"], default: "markdown" },
      },
    },
  },
  {
    name: "concept2_get_result",
    description: "Get detailed information about a single Concept2 workout result.",
    inputSchema: {
      type: "object",
      properties: {
        user: { type: "string", default: "me" },
        result_id: { type: "integer", description: "The workout ID." },
        include: { type: "string", description: "Comma-separated: 'strokes', 'metadata', 'user'." },
        response_format: { type: "string", enum: ["markdown", "json"], default: "markdown" },
      },
      required: ["result_id"],
    },
  },
  // Stroke Data Tools
  {
    name: "concept2_get_strokes",
    description: "Get per-stroke data for a Concept2 workout.",
    inputSchema: {
      type: "object",
      properties: {
        user: { type: "string", default: "me" },
        result_id: { type: "integer" },
        response_format: { type: "string", enum: ["markdown", "json"], default: "json" },
      },
      required: ["result_id"],
    },
  },
  // Challenge Tools
  {
    name: "concept2_get_challenges",
    description: "List Concept2 logbook challenges. No authentication required.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["current", "upcoming", "recent"] },
        days: { type: "integer", minimum: 1, maximum: 365, description: "Days for upcoming/recent." },
        season: { type: "integer", description: "Season year (e.g. 2024)." },
        page: { type: "integer", minimum: 1, default: 1 },
        response_format: { type: "string", enum: ["markdown", "json"], default: "markdown" },
      },
    },
  },
  {
    name: "concept2_get_events",
    description: "List non-challenge Concept2 events for a calendar year. No authentication required.",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "integer", minimum: 2010, maximum: 2030 },
        response_format: { type: "string", enum: ["markdown", "json"], default: "markdown" },
      },
      required: ["year"],
    },
  },

  // Summary Tool
  {
    name: "concept2_workout_summary",
    description: "Generate an aggregate summary of Concept2 workouts.",
    inputSchema: {
      type: "object",
      properties: {
        user: { type: "string", default: "me" },
        type: {
          type: "string",
          enum: ["rower", "skierg", "bike", "dynamic", "slides", "paddle", "water", "snow", "rollerski", "multierg"],
        },
        from_date: { type: "string" },
        to_date: { type: "string" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Handlers
// ---------------------------------------------------------------------------

async function handleAuthorize(args: { open_browser?: boolean }): Promise<string> {
  const openBrowser = args.open_browser !== false;

  // Check if using static token
  if (tokenManager.isUsingStaticToken()) {
    return (
      "Already authenticated using access token.\n\n" +
      "You're using CONCEPT2_ACCESS_TOKEN for authentication.\n" +
      "This token was generated from your Concept2 profile.\n\n" +
      "To use OAuth2 flow instead, remove CONCEPT2_ACCESS_TOKEN and set:\n" +
      "- CONCEPT2_CLIENT_ID\n" +
      "- CONCEPT2_CLIENT_SECRET"
    );
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    const devPortal = IS_DEV_SERVER
      ? "https://log-dev.concept2.com/developers/keys"
      : "https://log.concept2.com/developers/keys";
    return (
      "OAuth2 credentials not configured.\n\n" +
      "**Option 1: OAuth2 Flow (recommended for production)**\n" +
      "Set the following environment variables:\n" +
      "- CONCEPT2_CLIENT_ID: Your Concept2 OAuth2 Client ID\n" +
      "- CONCEPT2_CLIENT_SECRET: Your Concept2 OAuth2 Client Secret\n\n" +
      "**Option 2: Static Token (for development/testing)**\n" +
      "- CONCEPT2_ACCESS_TOKEN: A valid access token\n\n" +
      `Get credentials at: ${devPortal}`
    );
  }

  try {
    await tokenManager.runAuthorizationFlow(openBrowser);
    return (
      "Authorization successful!\n\n" +
      "Your Concept2 Logbook account is now connected. Tokens have been stored " +
      `and will be automatically refreshed when they expire.\n\n` +
      `Server: ${BASE_URL}\n` +
      `Token storage: ${TOKEN_FILE}`
    );
  } catch (e) {
    return `Authorization failed: ${e}`;
  }
}

async function handleAuthStatus(): Promise<string> {
  const lines = ["# Concept2 Authorization Status\n"];

  // Server info
  lines.push(`**Server:** ${BASE_URL}`);
  if (IS_DEV_SERVER) {
    lines.push("- Mode: Development (data may be reset periodically)");
  } else {
    lines.push("- Mode: Production");
  }

  // Check for static token first (takes priority over OAuth)
  if (tokenManager.isUsingStaticToken()) {
    lines.push("\n**Authentication:** Access Token");
    lines.push("- Using CONCEPT2_ACCESS_TOKEN environment variable");
    lines.push("- Tokens expire after 7 days - generate a new one when needed");
    if (CLIENT_ID || CLIENT_SECRET) {
      lines.push("- OAuth credentials present but ignored (ACCESS_TOKEN takes priority)");
    }
    return lines.join("\n");
  }

  // OAuth credentials
  if (CLIENT_ID && CLIENT_SECRET) {
    lines.push("\n**OAuth2 Credentials:** Configured");
    lines.push(`- Client ID: ${CLIENT_ID.length > 8 ? CLIENT_ID.slice(0, 8) + "..." : CLIENT_ID}`);
  } else {
    lines.push("\n**OAuth2 Credentials:** Not configured");
    lines.push("  Set CONCEPT2_CLIENT_ID and CONCEPT2_CLIENT_SECRET");
    lines.push("  Or use CONCEPT2_ACCESS_TOKEN for development");
    return lines.join("\n");
  }

  if (tokenManager.hasValidToken()) {
    lines.push("\n**Authentication:** Connected");
    const token = tokenManager.getTokenInfo();
    if (token) {
      if (tokenManager.isExpired()) {
        lines.push("- Token status: Expired (will refresh on next request)");
      } else {
        const remaining = Math.floor((token.expires_at - Date.now()) / 1000);
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        lines.push(`- Token status: Valid (expires in ${hours}h ${minutes}m)`);
      }
      if (token.scope) {
        lines.push(`- Scopes: ${token.scope}`);
      }
    }
    lines.push(`\n**Token storage:** ${TOKEN_FILE}`);
  } else {
    lines.push("\n**Authentication:** Not connected");
    lines.push("  Use concept2_authorize to connect your account");
  }

  return lines.join("\n");
}

async function handleLogout(): Promise<string> {
  tokenManager.clearTokens();
  return (
    "Successfully logged out. Stored tokens have been removed.\n\n" +
    "Use concept2_authorize to reconnect your Concept2 account."
  );
}

async function handleGetUser(args: { user?: string; response_format?: string }): Promise<string> {
  const user = args.user || "me";
  const format = args.response_format || "markdown";

  const data = await apiGet<ApiResponse<User>>(`/users/${user}`);

  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }
  return formatUserMarkdown(data.data);
}

async function handleGetResults(args: {
  user?: string;
  type?: string;
  from_date?: string;
  to_date?: string;
  updated_after?: string;
  page?: number;
  per_page?: number;
  response_format?: string;
}): Promise<string> {
  const user = args.user || "me";
  const format = args.response_format || "markdown";

  const params: Record<string, string | number | undefined> = {
    page: args.page || 1,
    number: args.per_page || 50,
  };
  if (args.type) params.type = args.type;
  if (args.from_date) params.from = args.from_date;
  if (args.to_date) params.to = args.to_date;
  if (args.updated_after) params.updated_after = args.updated_after;

  const data = await apiGet<ApiResponse<Result[]>>(`/users/${user}/results`, params);

  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }

  const results = data.data || [];
  const meta = data.meta?.pagination;
  let header = "# Workout Results";
  if (meta) {
    header += ` - Page ${meta.current_page} of ${meta.total_pages} (${meta.total} total)`;
  }
  header += "\n";

  if (results.length === 0) {
    return header + "\nNo results found matching your filters.";
  }

  return header + "\n" + results.map(formatResultMarkdown).join("\n\n");
}

async function handleGetResult(args: {
  user?: string;
  result_id: number;
  include?: string;
  response_format?: string;
}): Promise<string> {
  const user = args.user || "me";
  const format = args.response_format || "markdown";

  const params: Record<string, string | undefined> = {};
  if (args.include) params.include = args.include;

  const data = await apiGet<ApiResponse<Result>>(`/users/${user}/results/${args.result_id}`, params);

  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }
  return formatResultMarkdown(data.data);
}

async function handleGetStrokes(args: {
  user?: string;
  result_id: number;
  response_format?: string;
}): Promise<string> {
  const user = args.user || "me";
  const format = args.response_format || "json";

  const data = await apiGet<ApiResponse<Stroke[]>>(`/users/${user}/results/${args.result_id}/strokes`);

  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }

  const strokes = data.data || [];
  if (strokes.length === 0) {
    return "No stroke data available for this workout.";
  }

  const lines = [
    `# Stroke Data - Workout #${args.result_id}`,
    `**Total strokes:** ${strokes.length}\n`,
    "| # | Time | Distance | Pace | SPM | HR |",
    "|---|------|----------|------|-----|-----|",
  ];

  const displayStrokes = strokes.slice(0, 100);
  displayStrokes.forEach((s, i) => {
    const t = s.t ? formatTime(s.t) : "-";
    const d = s.d ? `${(s.d / 10).toFixed(1)}m` : "-";
    const p = s.p ? formatTime(s.p) : "-";
    const spm = s.spm?.toString() || "-";
    const hr = s.hr?.toString() || "-";
    lines.push(`| ${i + 1} | ${t} | ${d} | ${p} | ${spm} | ${hr} |`);
  });

  if (strokes.length > 100) {
    lines.push(`\n*Showing first 100 of ${strokes.length} strokes. Use JSON format for full data.*`);
  }

  return lines.join("\n");
}

async function handleGetChallenges(args: {
  filter?: string;
  days?: number;
  season?: number;
  page?: number;
  response_format?: string;
}): Promise<string> {
  const format = args.response_format || "markdown";

  let path: string;
  if (args.season) {
    path = `/challenges/season/${args.season}`;
  } else if (args.filter === "current") {
    path = "/challenges/current";
  } else if (args.filter === "upcoming") {
    path = `/challenges/upcoming/${args.days || 30}`;
  } else if (args.filter === "recent") {
    path = `/challenges/recent/${args.days || 30}`;
  } else {
    path = "/challenges";
  }

  const params: Record<string, number | undefined> = {};
  if (args.page && args.page > 1) params.page = args.page;

  const data = await apiGet<ApiResponse<Challenge[]>>(path, params, false);

  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }

  const challenges = data.data || [];
  if (challenges.length === 0) {
    return "No challenges found matching your criteria.";
  }

  const meta = data.meta?.pagination;
  let header = "# Concept2 Challenges";
  if (meta) {
    header += ` - Page ${meta.current_page} of ${meta.total_pages}`;
  }

  return header + "\n\n" + challenges.map(formatChallengeMarkdown).join("\n\n");
}

async function handleGetEvents(args: { year: number; response_format?: string }): Promise<string> {
  const format = args.response_format || "markdown";

  const data = await apiGet<ApiResponse<Challenge[]>>(`/challenges/events/${args.year}`, undefined, false);

  if (format === "json") {
    return JSON.stringify(data, null, 2);
  }

  const events = data.data || [];
  if (events.length === 0) {
    return `No events found for ${args.year}.`;
  }

  const lines = [`# Concept2 Events - ${args.year}\n`];
  for (const ev of events) {
    lines.push(`### ${ev.name || "Unknown"}`);
    lines.push(`- **Dates:** ${ev.start || "?"} -> ${ev.end || "?"}`);
    lines.push(`- **Activity:** ${ev.activity || "N/A"}`);
    lines.push(`- **Description:** ${ev.description || ""}`);
    lines.push(`- **Link:** ${ev.link || ""}\n`);
  }

  return lines.join("\n");
}

async function handleWorkoutSummary(args: {
  user?: string;
  type?: string;
  from_date?: string;
  to_date?: string;
}): Promise<string> {
  const user = args.user || "me";

  const allResults: Result[] = [];
  let page = 1;

  while (true) {
    const params: Record<string, string | number | undefined> = {
      page,
      number: 250,
    };
    if (args.type) params.type = args.type;
    if (args.from_date) params.from = args.from_date;
    if (args.to_date) params.to = args.to_date;

    const data = await apiGet<ApiResponse<Result[]>>(`/users/${user}/results`, params);
    const results = data.data || [];
    allResults.push(...results);

    const meta = data.meta?.pagination;
    if (!meta || page >= meta.total_pages) break;
    page++;
    if (page > 20) break; // Safety limit
  }

  if (allResults.length === 0) {
    return "No workouts found matching your filters.";
  }

  const totalDist = allResults.reduce((sum, r) => sum + (r.distance || 0), 0);
  const totalTime = allResults.reduce((sum, r) => sum + (r.time || 0), 0);
  const count = allResults.length;

  const spmValues = allResults.filter((r) => r.stroke_rate).map((r) => r.stroke_rate!);
  const calValues = allResults.filter((r) => r.calories_total).map((r) => r.calories_total!);

  let avgPace500 = "";
  if (totalDist > 0 && totalTime > 0) {
    const paceSec = (totalTime / 10) / (totalDist / 500);
    avgPace500 = formatTime(Math.round(paceSec * 10));
  }

  const byType: Record<string, number> = {};
  for (const r of allResults) {
    const t = r.type || "unknown";
    byType[t] = (byType[t] || 0) + 1;
  }

  const lines = ["# Concept2 Workout Summary\n"];
  if (args.from_date || args.to_date) {
    lines.push(`**Period:** ${args.from_date || "start"} -> ${args.to_date || "now"}`);
  }
  if (args.type) {
    lines.push(`**Equipment:** ${args.type}`);
  }
  lines.push(`\n**Total Workouts:** ${count}`);
  lines.push(`**Total Distance:** ${totalDist.toLocaleString()} m (${(totalDist / 1000).toFixed(1)} km)`);
  lines.push(`**Total Time:** ${formatTime(totalTime)}`);
  if (avgPace500) {
    lines.push(`**Avg Pace:** ${avgPace500}/500m`);
  }
  lines.push(`**Avg Distance/Workout:** ${Math.floor(totalDist / count).toLocaleString()} m`);
  lines.push(`**Avg Time/Workout:** ${formatTime(Math.floor(totalTime / count))}`);
  if (spmValues.length > 0) {
    const avgSpm = spmValues.reduce((a, b) => a + b, 0) / spmValues.length;
    lines.push(`**Avg Stroke Rate:** ${avgSpm.toFixed(0)} spm`);
  }
  if (calValues.length > 0) {
    const totalCals = calValues.reduce((a, b) => a + b, 0);
    lines.push(`**Total Calories:** ${totalCals.toLocaleString()}`);
  }

  if (Object.keys(byType).length > 1) {
    lines.push("\n**By Equipment:**");
    const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    for (const [t, c] of sorted) {
      lines.push(`- ${t}: ${c} workouts`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "concept2_authorize":
        return await handleAuthorize(args as { open_browser?: boolean });
      case "concept2_auth_status":
        return await handleAuthStatus();
      case "concept2_logout":
        return await handleLogout();
      case "concept2_get_user":
        return await handleGetUser(args as { user?: string; response_format?: string });
      case "concept2_get_results":
        return await handleGetResults(args as Parameters<typeof handleGetResults>[0]);
      case "concept2_get_result":
        return await handleGetResult(args as Parameters<typeof handleGetResult>[0]);
      case "concept2_get_strokes":
        return await handleGetStrokes(args as Parameters<typeof handleGetStrokes>[0]);
      case "concept2_get_challenges":
        return await handleGetChallenges(args as Parameters<typeof handleGetChallenges>[0]);
      case "concept2_get_events":
        return await handleGetEvents(args as Parameters<typeof handleGetEvents>[0]);
      case "concept2_workout_summary":
        return await handleWorkoutSummary(args as Parameters<typeof handleWorkoutSummary>[0]);
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e) {
    if (e instanceof Error) {
      return `Error: ${e.message}`;
    }
    return `Error: ${e}`;
  }
}

// ---------------------------------------------------------------------------
// Server Setup
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "concept2-logbook",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  }
);

// ---------------------------------------------------------------------------
// Logging Helper
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warning" | "error";

const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  none: 4,
};

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.none;
  const messageLevel = LOG_LEVELS[level] ?? 0;
  return messageLevel >= configuredLevel;
}

function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  // Log to stderr
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  console.error(`[${timestamp}] [concept2] [${level.toUpperCase()}] ${message}${dataStr}`);

  // Send to MCP client (shows in Claude)
  server.sendLoggingMessage({
    level: level as LoggingLevel,
    logger: "concept2",
    data: data ? { message, ...data } : message,
  }).catch(() => {
    // Ignore if client doesn't support logging
  });
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log("debug", `Tool called: ${name}`, args as Record<string, unknown>);

  const result = await handleToolCall(name, (args || {}) as Record<string, unknown>);
  return {
    content: [{ type: "text", text: result }],
  };
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "MCP server started", { server: BASE_URL });
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
