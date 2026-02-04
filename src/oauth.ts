import { createServer, IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import { readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import open from "open";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const BASE_URL = process.env.CONCEPT2_BASE_URL || "https://log.concept2.com";
export const CLIENT_ID = process.env.CONCEPT2_CLIENT_ID || "";
export const CLIENT_SECRET = process.env.CONCEPT2_CLIENT_SECRET || "";
export const OAUTH_SCOPES = process.env.CONCEPT2_SCOPES || "user:read,results:read";
export const REDIRECT_PORT = parseInt(process.env.CONCEPT2_REDIRECT_PORT || "49721", 10);
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
export const TOKEN_FILE = process.env.CONCEPT2_TOKEN_FILE || join(homedir(), ".concept2_mcp_tokens.json");

// Authorization timeout in milliseconds (default: 1 minute)
export const AUTH_TIMEOUT_MS = parseInt(process.env.CONCEPT2_AUTH_TIMEOUT_MS || "60000", 10);

// Direct access token for development/testing (bypasses OAuth flow)
export const STATIC_ACCESS_TOKEN = process.env.CONCEPT2_ACCESS_TOKEN || "";

// Check if we're in development mode
export const IS_DEV_SERVER = BASE_URL.includes("log-dev.concept2.com");

// Logging level: "debug" | "info" | "warning" | "error" | "none"
export const LOG_LEVEL = (process.env.CONCEPT2_LOG_LEVEL || "none").toLowerCase();

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

function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const configuredLevel = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.none;
  const messageLevel = LOG_LEVELS[level] ?? 0;
  if (messageLevel < configuredLevel) return;

  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  console.error(`[${timestamp}] [concept2:oauth] [${level.toUpperCase()}] ${message}${dataStr}`);
}

// ---------------------------------------------------------------------------
// Token Data
// ---------------------------------------------------------------------------

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in milliseconds
  token_type: string;
  scope: string;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

// ---------------------------------------------------------------------------
// Token Manager
// ---------------------------------------------------------------------------

class TokenManager {
  private token: TokenData | null = null;
  private usingStaticToken: boolean = false;

  constructor() {
    // Static access token takes priority over OAuth flow
    // Can be generated at: Profile -> Applications -> "Connect to Concept2 Logbook API"
    if (STATIC_ACCESS_TOKEN) {
      this.token = {
        access_token: STATIC_ACCESS_TOKEN,
        refresh_token: "",
        expires_at: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year from now
        token_type: "Bearer",
        scope: OAUTH_SCOPES,
      };
      this.usingStaticToken = true;
      log("info", "Using static access token from CONCEPT2_ACCESS_TOKEN", { server: BASE_URL });
      if (CLIENT_ID || CLIENT_SECRET) {
        log("warning", "OAuth credentials ignored when ACCESS_TOKEN is set");
      }
    } else {
      this.loadTokens();
    }
  }

  isUsingStaticToken(): boolean {
    return this.usingStaticToken;
  }

  private loadTokens(): void {
    log("debug", "Checking for existing tokens", { path: TOKEN_FILE });
    if (existsSync(TOKEN_FILE)) {
      try {
        const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
        this.token = data as TokenData;
        const expiresIn = Math.floor((this.token.expires_at - Date.now()) / 1000);
        log("info", "Loaded existing OAuth2 tokens", {
          path: TOKEN_FILE,
          expires_in_seconds: expiresIn,
          scope: this.token.scope
        });
      } catch (e) {
        log("error", "Failed to load tokens", { path: TOKEN_FILE, error: String(e) });
        this.token = null;
      }
    } else {
      log("debug", "No existing token file found");
    }
  }

  private saveTokens(): void {
    if (this.token) {
      try {
        log("debug", "Saving tokens to file", { path: TOKEN_FILE });
        writeFileSync(TOKEN_FILE, JSON.stringify(this.token, null, 2));
        // Try to set restrictive permissions (may not work on Windows)
        try {
          chmodSync(TOKEN_FILE, 0o600);
        } catch {
          // Ignore permission errors on Windows
        }
        log("info", "Saved OAuth2 tokens", { path: TOKEN_FILE });
      } catch (e) {
        log("error", "Failed to save tokens", { path: TOKEN_FILE, error: String(e) });
      }
    }
  }

  clearTokens(): void {
    log("info", "Clearing stored tokens");
    this.token = null;
    if (existsSync(TOKEN_FILE)) {
      try {
        unlinkSync(TOKEN_FILE);
        log("debug", "Deleted token file", { path: TOKEN_FILE });
      } catch (e) {
        log("warning", "Failed to delete token file", { path: TOKEN_FILE, error: String(e) });
      }
    }
  }

  hasValidToken(): boolean {
    return this.token !== null;
  }

  needsAuthorization(): boolean {
    // Static token doesn't need OAuth flow
    if (this.usingStaticToken) {
      return false;
    }
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return false;
    }
    return this.token === null;
  }

  isExpired(bufferMs: number = 60000): boolean {
    if (!this.token) return true;
    return Date.now() >= this.token.expires_at - bufferMs;
  }

  getTokenInfo(): TokenData | null {
    return this.token;
  }

  async getAccessToken(): Promise<string> {
    log("debug", "Getting access token");

    if (!this.token) {
      log("error", "No token available");
      throw new Error(
        "Not authenticated. Either:\n" +
        "1. Set CONCEPT2_ACCESS_TOKEN for development/testing, or\n" +
        "2. Set CONCEPT2_CLIENT_ID and CONCEPT2_CLIENT_SECRET, then use concept2_authorize"
      );
    }

    // Static tokens don't get refreshed
    if (this.usingStaticToken) {
      log("debug", "Using static token");
      return this.token.access_token;
    }

    if (this.isExpired()) {
      log("info", "Token expired, refreshing");
      await this.refreshToken();
    }

    return this.token.access_token;
  }

  private async refreshToken(): Promise<void> {
    if (!this.token) {
      throw new Error("No refresh token available");
    }

    log("info", "Refreshing OAuth2 access token");

    const startTime = Date.now();
    const response = await fetch(`${BASE_URL}/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: this.token.refresh_token,
      }),
    });
    const elapsed = Date.now() - startTime;

    log("debug", "Token refresh response", { status: response.status, elapsed_ms: elapsed });

    if (!response.ok) {
      const errorText = await response.text();
      log("error", "Token refresh failed", { status: response.status, error: errorText });
      this.clearTokens();
      throw new Error("Token refresh failed. Please re-authorize using concept2_authorize tool.");
    }

    const data = (await response.json()) as OAuthTokenResponse;
    this.token = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      token_type: data.token_type || "Bearer",
      scope: data.scope || "",
    };
    this.saveTokens();
    log("info", "Successfully refreshed OAuth2 token", { expires_in: data.expires_in });
  }

  async exchangeCode(code: string): Promise<void> {
    log("info", "Exchanging authorization code for tokens");

    const startTime = Date.now();
    const response = await fetch(`${BASE_URL}/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI,
        scope: OAUTH_SCOPES,
      }),
    });
    const elapsed = Date.now() - startTime;

    log("debug", "Token exchange response", { status: response.status, elapsed_ms: elapsed });

    if (!response.ok) {
      const errorText = await response.text();
      log("error", "Token exchange failed", { status: response.status, error: errorText });
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const data = (await response.json()) as OAuthTokenResponse;
    this.token = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      token_type: data.token_type || "Bearer",
      scope: data.scope || "",
    };
    this.saveTokens();
    log("info", "Successfully obtained OAuth2 tokens", { expires_in: data.expires_in, scope: data.scope });
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      scope: OAUTH_SCOPES,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      state: state,
    });
    return `${BASE_URL}/oauth/authorize?${params}`;
  }

  async runAuthorizationFlow(openBrowser: boolean = true): Promise<string> {
    log("info", "Starting OAuth2 authorization flow", { openBrowser });

    if (this.usingStaticToken) {
      log("debug", "Already using static token, skipping OAuth flow");
      return "Already authenticated using static access token (CONCEPT2_ACCESS_TOKEN).";
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      log("error", "OAuth2 credentials not configured");
      throw new Error(
        "OAuth2 credentials not configured. Set CONCEPT2_CLIENT_ID and " +
        "CONCEPT2_CLIENT_SECRET environment variables."
      );
    }

    const state = generateState();
    const authUrl = this.getAuthorizationUrl(state);
    log("debug", "Generated authorization URL", { redirect_uri: REDIRECT_URI });

    // Start callback server
    const { code, receivedState } = await runCallbackServer(authUrl, openBrowser);

    if (receivedState !== state) {
      log("error", "OAuth2 state mismatch", { expected: state, received: receivedState });
      throw new Error("OAuth2 state mismatch - possible CSRF attack");
    }

    log("debug", "Authorization code received, exchanging for tokens");
    // Exchange code for tokens
    await this.exchangeCode(code);

    return "Authorization successful!";
  }
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface CallbackResult {
  code: string;
  receivedState: string;
}

function runCallbackServer(authUrl: string, openBrowser: boolean): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    log("debug", "Starting OAuth2 callback server", { port: REDIRECT_PORT, timeout_ms: AUTH_TIMEOUT_MS });

    const timeout = setTimeout(() => {
      log("error", "OAuth2 authorization timed out");
      server.close();
      reject(new Error("OAuth2 authorization timed out. Please try again."));
    }, AUTH_TIMEOUT_MS);

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "", `http://localhost:${REDIRECT_PORT}`);
      log("debug", "Callback server received request", { path: url.pathname });

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const errorDesc = url.searchParams.get("error_description") || "Unknown error";
        log("error", "OAuth2 callback received error", { error, description: errorDesc });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Authorization Failed</h1>
          <p style="color: red;">${errorDesc}</p>
          <p>You can close this window.</p>
          </body></html>
        `);
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth2 error: ${error} - ${errorDesc}`));
        return;
      }

      const code = url.searchParams.get("code");
      const receivedState = url.searchParams.get("state") || "";

      if (!code) {
        log("error", "OAuth2 callback missing authorization code");
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`
          <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Invalid Request</h1>
          <p>Missing authorization code.</p>
          </body></html>
        `);
        clearTimeout(timeout);
        server.close();
        reject(new Error("Missing authorization code"));
        return;
      }

      log("info", "OAuth2 authorization code received");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1>Authorization Successful!</h1>
        <p>You can close this window and return to your application.</p>
        </body></html>
      `);

      clearTimeout(timeout);
      server.close();
      resolve({ code, receivedState });
    });

    server.listen(REDIRECT_PORT, "localhost", () => {
      log("info", "OAuth2 callback server listening", { port: REDIRECT_PORT });

      if (openBrowser) {
        log("debug", "Opening browser for authorization");
        open(authUrl).catch((err) => {
          log("error", "Failed to open browser", { error: String(err) });
        });
      }
    });

    server.on("error", (err) => {
      log("error", "Callback server error", { error: err.message });
      clearTimeout(timeout);
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Export singleton
// ---------------------------------------------------------------------------

export const tokenManager = new TokenManager();
