import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Short name shown on schedules, exports, name tags, notifications.
 * Falls back to full name when display_name is empty/null. */
export function displayName(m: { display_name?: string | null; name: string } | null | undefined): string {
  if (!m) return "";
  const d = (m.display_name || "").trim();
  return d || m.name;
}
