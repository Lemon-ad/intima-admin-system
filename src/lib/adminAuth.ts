// ─── Admin (full access) ───
// SHA-256 hash of "admin123"
const ADMIN_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
// SHA-256 hash of "intima67"
const PUBLIC_HASH = "6f53cce24a76c4fd4a4c006c44d717a4deb6eb72f98f503188da7567bddc70b7";

// 24 hours in milliseconds
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Role = "admin" | "public" | null;

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const hash = await sha256(password);
  return hash === ADMIN_HASH;
}

export async function verifyPublicPassword(password: string): Promise<boolean> {
  const hash = await sha256(password);
  return hash === PUBLIC_HASH || password === "intima67";
}

// Determine role from password (admin tried first)
export async function detectRoleFromPassword(password: string): Promise<Role> {
  if (await verifyAdminPassword(password)) return "admin";
  if (await verifyPublicPassword(password)) return "public";
  return null;
}

// ─── Session storage with 24h expiry ───
// We persist to localStorage so closing tab/browser preserves the session
// for up to 24h, instead of resetting on every tab close.
type StoredSession = { role: "admin" | "public"; ts: number };
const SESSION_KEY = "intima_session_v2";

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.role || !parsed?.ts) return null;
    if (Date.now() - parsed.ts > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(role: "admin" | "public") {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ role, ts: Date.now() }));
}

export function isAdminAuthenticated(): boolean {
  return readSession()?.role === "admin";
}

export function isPublicAuthenticated(): boolean {
  return readSession()?.role === "public";
}

export function isAuthenticated(): boolean {
  return readSession() !== null;
}

export function getCurrentRole(): Role {
  return readSession()?.role ?? null;
}

export function setRole(role: "admin" | "public"): void {
  writeSession(role);
  // Clear legacy keys
  sessionStorage.removeItem("intima_admin");
  sessionStorage.removeItem("intima_public");
}

export function setAdminAuthenticated(): void {
  setRole("admin");
}

export function clearAdminAuth(): void {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem("intima_admin");
  sessionStorage.removeItem("intima_public");
}

// 4-digit PIN hashing for schedules created by public users
export async function hashPin(pin: string): Promise<string> {
  return sha256("schedule-pin:" + pin);
}

export async function verifyPin(pin: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return true;
  const h = await hashPin(pin);
  return h === hash;
}

// Per-session unlocked schedule IDs (public users) with 24h expiry
type UnlockMap = Record<string, number>; // id -> timestamp
const UNLOCKED_KEY = "intima_unlocked_schedules_v2";

function readUnlocks(): UnlockMap {
  try {
    const raw = localStorage.getItem(UNLOCKED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UnlockMap;
    const now = Date.now();
    let mutated = false;
    for (const k of Object.keys(parsed)) {
      if (now - parsed[k] > SESSION_TTL_MS) {
        delete parsed[k];
        mutated = true;
      }
    }
    if (mutated) localStorage.setItem(UNLOCKED_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return {};
  }
}

export function unlockSchedule(id: string): void {
  const map = readUnlocks();
  map[id] = Date.now();
  localStorage.setItem(UNLOCKED_KEY, JSON.stringify(map));
}

export function isScheduleUnlocked(id: string): boolean {
  if (isAdminAuthenticated()) return true;
  return !!readUnlocks()[id];
}
