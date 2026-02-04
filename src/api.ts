import { tokenManager, BASE_URL, LOG_LEVEL } from "./oauth.js";

const API_BASE = `${BASE_URL}/api`;

// ---------------------------------------------------------------------------
// Logging (standalone for api module)
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
  console.error(`[${timestamp}] [concept2:api] [${level.toUpperCase()}] ${message}${dataStr}`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiResponse<T = unknown> {
  data: T;
  meta?: {
    pagination?: {
      total: number;
      count: number;
      per_page: number;
      current_page: number;
      total_pages: number;
    };
  };
}

export interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  gender: string;
  dob: string;
  country: string;
  max_heart_rate?: number;
  weight?: number;
  logbook_privacy?: string;
}

export interface HeartRate {
  average?: number;
  max?: number;
  min?: number;
}

export interface Result {
  id: number;
  date: string;
  type: string;
  workout_type: string;
  distance: number;
  time: number;
  time_formatted?: string;
  stroke_rate?: number;
  stroke_count?: number;
  calories_total?: number;
  drag_factor?: number;
  heart_rate?: HeartRate;
  weight_class?: string;
  comments?: string;
  source?: string;
  verified?: boolean;
}

export interface Stroke {
  t?: number; // time in tenths of second
  d?: number; // distance in decimeters
  p?: number; // pace in tenths of second per 500m/1000m
  spm?: number;
  hr?: number;
}

export interface Challenge {
  id: number;
  name: string;
  season: number;
  start: string;
  end: string;
  activity: string;
  category: string;
  description: string;
  link: string;
}

// ---------------------------------------------------------------------------
// HTTP Helpers
// ---------------------------------------------------------------------------

async function getAuthHeaders(): Promise<Record<string, string>> {
  const accessToken = await tokenManager.getAccessToken();
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.c2logbook.v1+json",
  };
}

function getPublicHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/vnd.c2logbook.v1+json",
  };
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  authenticated: boolean = true
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  log("debug", `GET ${path}`, { params, authenticated });

  const headers = authenticated ? await getAuthHeaders() : getPublicHeaders();
  const startTime = Date.now();
  const response = await fetch(url.toString(), { headers });
  const elapsed = Date.now() - startTime;

  log("debug", `GET ${path} completed`, { status: response.status, elapsed_ms: elapsed });

  if (!response.ok) {
    log("error", `GET ${path} failed`, { status: response.status });
    await handleApiError(response);
  }

  const data = await response.json() as T;
  log("debug", `GET ${path} response parsed`, {
    hasData: !!(data as Record<string, unknown>)?.data,
    hasMeta: !!(data as Record<string, unknown>)?.meta
  });

  return data;
}

export async function apiPost<T>(
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    await handleApiError(response);
  }

  return response.json() as Promise<T>;
}

export async function apiPatch<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await handleApiError(response);
  }

  return response.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    await handleApiError(response);
  }

  return response.json() as Promise<T>;
}

async function handleApiError(response: Response): Promise<never> {
  const status = response.status;
  let detail: string;
  try {
    detail = JSON.stringify(await response.json(), null, 2);
  } catch {
    detail = await response.text();
  }

  const messages: Record<number, string> = {
    401: "Authentication failed. Token may be expired. Use concept2_authorize to re-authenticate.",
    403: "Permission denied. Your token may lack the required scope.",
    404: "Resource not found. Double-check the ID or endpoint.",
    409: "Duplicate result. A workout with the same date, time, and distance already exists.",
    422: `Validation error: ${detail}`,
    429: "Rate limited. Wait a moment before retrying.",
  };

  throw new Error(messages[status] || `API error ${status}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

export function formatTime(tenths: number): string {
  const totalSec = tenths / 10;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
  }
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export function formatUserMarkdown(u: User): string {
  const lines = [
    `## ${u.first_name || ""} ${u.last_name || ""}`,
    `- **Username:** ${u.username || "N/A"}`,
    `- **ID:** ${u.id || "N/A"}`,
    `- **Gender:** ${u.gender || "N/A"}`,
    `- **Country:** ${u.country || "N/A"}`,
    `- **Date of Birth:** ${u.dob || "N/A"}`,
  ];

  if (u.max_heart_rate) {
    lines.push(`- **Max HR:** ${u.max_heart_rate}`);
  }
  if (u.weight) {
    const kg = u.weight / 100;
    lines.push(`- **Weight:** ${kg.toFixed(1)} kg`);
  }
  if (u.logbook_privacy) {
    lines.push(`- **Privacy:** ${u.logbook_privacy}`);
  }

  return lines.join("\n");
}

export function formatResultMarkdown(r: Result): string {
  const dateStr = r.date || "Unknown date";
  const dist = r.distance || 0;
  const timeFmt = r.time_formatted || formatTime(r.time || 0);
  const etype = r.type || "unknown";
  const wtype = r.workout_type || "unknown";

  let pace500 = "";
  if (r.time && r.distance && r.distance > 0) {
    const paceSec = (r.time / 10) / (r.distance / 500);
    pace500 = ` | Pace: ${formatTime(Math.round(paceSec * 10))}/500m`;
  }

  const lines = [
    `### #${r.id || "?"} - ${dateStr}`,
    `- **Type:** ${etype} (${wtype})`,
    `- **Distance:** ${dist.toLocaleString()}m | **Time:** ${timeFmt}${pace500}`,
  ];

  if (r.stroke_rate) {
    lines.push(`- **Avg SPM:** ${r.stroke_rate}`);
  }
  if (r.calories_total) {
    lines.push(`- **Calories:** ${r.calories_total}`);
  }
  if (r.heart_rate) {
    const hrParts = Object.entries(r.heart_rate)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`);
    if (hrParts.length > 0) {
      lines.push(`- **Heart Rate:** ${hrParts.join(", ")}`);
    }
  }
  if (r.drag_factor) {
    lines.push(`- **Drag Factor:** ${r.drag_factor}`);
  }
  if (r.weight_class) {
    lines.push(`- **Weight Class:** ${r.weight_class}`);
  }
  if (r.comments) {
    lines.push(`- **Comments:** ${r.comments}`);
  }

  const verified = r.verified ? "Yes" : "No";
  lines.push(`- **Verified:** ${verified} | **Source:** ${r.source || "N/A"}`);

  return lines.join("\n");
}

export function formatChallengeMarkdown(c: Challenge): string {
  return [
    `### ${c.name || "Unknown"}`,
    `- **Season:** ${c.season || "N/A"}`,
    `- **Dates:** ${c.start || "?"} -> ${c.end || "?"}`,
    `- **Activity:** ${c.activity || "N/A"}`,
    `- **Category:** ${c.category || "N/A"}`,
    `- **Description:** ${c.description || ""}`,
    `- **Link:** ${c.link || ""}`,
  ].join("\n");
}
