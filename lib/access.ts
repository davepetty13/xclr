import "server-only";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/session";

// Invite-only access (migration 010, app_members).
//   owner  — Dave. Sees People, no AI limit, can't delete himself.
//   member — a friend Dave invited. status invited → active on first sign-in;
//            paused = no access until Dave resumes them.

export const DEFAULT_AI_LIMIT_USD = 1.5;
export const MAX_MEMBERS = 50;
// Per-person monthly limits the owner can pick (People → ⋯).
export const LIMIT_OPTIONS = [0.5, 1, 1.5, 2, 3, 5] as const;

export type Role = "owner" | "member";
export type MemberStatus = "invited" | "active" | "paused";
export type Access = { email: string; role: Role; status: MemberStatus; limit: number };

export function normEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

// Plain email shape check (no spaces, one @, a dot in the domain, sane length).
export function isEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/.test(v);
}

function toAccess(row: Record<string, unknown> | null): Access | null {
  if (!row) return null;
  return {
    email: String(row.email),
    role: row.role === "owner" ? "owner" : "member",
    status: row.status === "active" ? "active" : row.status === "paused" ? "paused" : "invited",
    limit: Number(row.ai_limit_usd) || 0,
  };
}

// The member row for this auth user: by user_id first, else by email (an
// invite that hasn't been linked yet). Service-role read, always filtered.
export async function getAccess(user: Pick<User, "id" | "email">): Promise<Access | null> {
  const admin = createAdminClient();
  const { data: byId, error } = await admin
    .from("app_members")
    .select("email, role, status, ai_limit_usd")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) console.error(`[access] by user_id failed: ${error.message}`);
  if (byId) return toAccess(byId);
  const email = normEmail(user.email);
  if (!email) return null;
  const { data: byEmail } = await admin
    .from("app_members")
    .select("email, role, status, ai_limit_usd")
    .eq("email", email)
    .maybeSingle();
  return toAccess(byEmail);
}

export function canUse(a: Access | null): boolean {
  return !!a && (a.role === "owner" || a.status === "active");
}

// One lookup per request for the signed-in user (React cache): pages and
// server actions that need the role / limit share it.
export const getCurrentAccess = cache(async (): Promise<Access | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  return getAccess(user);
});

export async function isOwner(): Promise<boolean> {
  return (await getCurrentAccess())?.role === "owner";
}
