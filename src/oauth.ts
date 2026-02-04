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
export const OAUTH_SCOPES = process.env.CONCEPT2_SCOPES || "user:read,results:write";
export const REDIRECT_PORT = parseInt(process.env.CONCEPT2_REDIRECT_PORT || "49721", 10);
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
export const TOKEN_FILE = process.env.CONCEPT2_TOKEN_FILE || join(homedir(), ".concept2_mcp_tokens.json");

// Direct access token for development/testing (bypasses OAuth flow)
export const STATIC_ACCESS_TOKEN = process.env.CONCEPT2_ACCESS_TOKEN || "";

// Check if we're in development mode
export const IS_DEV_SERVER = BASE_URL.includes("log-dev.concept2.com");

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
    // Static access token takes priority (development/testing mode)
    // If CONCEPT2_ACCESS_TOKEN is set, OAuth credentials are ignored
    if (STATIC_ACCESS_TOKEN) {
      this.token = {
        access_token: STATIC_ACCESS_TOKEN,
        refresh_token: "",
        expires_at: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year from now
        token_type: "Bearer",
        scope: OAUTH_SCOPES,
      };
      this.usingStaticToken = true;
      console.error(`[concept2] Development/testing mode: using CONCEPT2_ACCESS_TOKEN`);
      console.error(`[concept2] Server: ${BASE_URL}`);
      if (CLIENT_ID || CLIENT_SECRET) {
        console.error(`[concept2] Note: OAuth credentials ignored when ACCESS_TOKEN is set`);
      }
    } else {
      this.loadTokens();
    }
  }

  isUsingStaticToken(): boolean {
    return this.usingStaticToken;
  }

  private loadTokens(): void {
    if (existsSync(TOKEN_FILE)) {
      try {
        const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
        this.token = data as TokenData;
        console.error(`[concept2] Loaded existing OAuth2 tokens from ${TOKEN_FILE}`);
      } catch (e) {
        console.error(`[concept2] Failed to load tokens: ${e}`);
        this.token = null;
      }
    }
  }

  private saveTokens(): void {
    if (this.token) {
      try {
        writeFileSync(TOKEN_FILE, JSON.stringify(this.token, null, 2));
        // Try to set restrictive permissions (may not work on Windows)
        try {
          chmodSync(TOKEN_FILE, 0o600);
        } catch {
          // Ignore permission errors on Windows
        }
        console.error(`[concept2] Saved OAuth2 tokens to ${TOKEN_FILE}`);
      } catch (e) {
        console.error(`[concept2] Failed to save tokens: ${e}`);
      }
    }
  }

  clearTokens(): void {
    this.token = null;
    if (existsSync(TOKEN_FILE)) {
      try {
        unlinkSync(TOKEN_FILE);
      } catch {
        // Ignore
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
    if (!this.token) {
      throw new Error(
        "Not authenticated. Either:\n" +
        "1. Set CONCEPT2_ACCESS_TOKEN for development/testing, or\n" +
        "2. Set CONCEPT2_CLIENT_ID and CONCEPT2_CLIENT_SECRET, then use concept2_authorize"
      );
    }

    // Static tokens don't get refreshed
    if (this.usingStaticToken) {
      return this.token.access_token;
    }

    if (this.isExpired()) {
      await this.refreshToken();
    }

    return this.token.access_token;
  }

  private async refreshToken(): Promise<void> {
    if (!this.token) {
      throw new Error("No refresh token available");
    }

    console.error("[concept2] Refreshing OAuth2 access token...");

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

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[concept2] Token refresh failed: ${errorText}`);
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
    console.error("[concept2] Successfully refreshed OAuth2 token");
  }

  async exchangeCode(code: string): Promise<void> {
    console.error("[concept2] Exchanging authorization code for tokens...");

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

    if (!response.ok) {
      const errorText = await response.text();
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
    console.error("[concept2] Successfully obtained OAuth2 tokens");
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
    if (this.usingStaticToken) {
      return "Already authenticated using static access token (CONCEPT2_ACCESS_TOKEN).";
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error(
        "OAuth2 credentials not configured. Set CONCEPT2_CLIENT_ID and " +
        "CONCEPT2_CLIENT_SECRET environment variables."
      );
    }

    const state = generateState();
    const authUrl = this.getAuthorizationUrl(state);

    // Start callback server
    const { code, receivedState } = await runCallbackServer(authUrl, openBrowser);

    if (receivedState !== state) {
      throw new Error("OAuth2 state mismatch - possible CSRF attack");
    }

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
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth2 authorization timed out. Please try again."));
    }, 120000); // 2 minute timeout

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "", `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const errorDesc = url.searchParams.get("error_description") || "Unknown error";
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
      console.error(`[concept2] Starting OAuth2 callback server on port ${REDIRECT_PORT}`);

      if (openBrowser) {
        open(authUrl).catch((err) => {
          console.error(`[concept2] Failed to open browser: ${err}`);
        });
      }
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Export singleton
// ---------------------------------------------------------------------------

export const tokenManager = new TokenManager();
