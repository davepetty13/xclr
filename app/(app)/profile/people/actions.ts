"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_AI_LIMIT_USD, LIMIT_OPTIONS, MAX_MEMBERS, getCurrentAccess, isEmail, normEmail } from "@/lib/access";
import { deleteUserEverything } from "@/lib/delete-user";

// Owner-only writes to app_members. Every action checks the caller is the
// owner first, then uses the service-role client (RLS gives users no writes).
// The owner's own row can't be paused, limited or removed.

export type PeopleResult = { ok: true; message?: string } | { ok: false; error: string };

const NOT_OWNER: PeopleResult = { ok: false, error: "Only the owner can change people." };

async function ownerOnly(): Promise<boolean> {
  // A failed lookup throws (lib/access.ts) → not the owner (fail closed).
  const a = await getCurrentAccess().catch(() => null);
  return a?.role === "owner";
}

async function memberRow(email: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_members")
    .select("email, role, status, user_id")
    .eq("email", email)
    .maybeSingle();
  return { admin, row: data };
}

function done(message?: string): PeopleResult {
  revalidatePath("/profile/people");
  return { ok: true, ...(message ? { message } : {}) };
}

export async function inviteMember(rawEmail: string): Promise<PeopleResult> {
  if (!(await ownerOnly())) return NOT_OWNER;
  const email = normEmail(rawEmail);
  if (!email || !isEmail(email)) return { ok: false, error: "That doesn't look like an email address." };

  const admin = createAdminClient();
  const { count, error: cErr } = await admin.from("app_members").select("email", { count: "exact", head: true });
  if (cErr) return { ok: false, error: "Couldn't check the list. Try again." };
  if ((count ?? 0) >= MAX_MEMBERS) return { ok: false, error: `Xclr is full at ${MAX_MEMBERS} people. Remove someone first.` };

  const { data: existing } = await admin.from("app_members").select("email").eq("email", email).maybeSingle();
  if (existing) return { ok: false, error: "That email is already on the list." };

  const { error } = await admin.from("app_members").insert({
    email,
    role: "member",
    status: "invited",
    ai_limit_usd: DEFAULT_AI_LIMIT_USD,
  });
  if (error) {
    console.error(`[people] invite failed: ${error.message}`);
    return { ok: false, error: "Couldn't add them. Try again." };
  }
  return done(`${email} can sign in now. Send them the link.`);
}

export async function setMemberLimit(rawEmail: string, limit: number): Promise<PeopleResult> {
  if (!(await ownerOnly())) return NOT_OWNER;
  const email = normEmail(rawEmail);
  if (!LIMIT_OPTIONS.includes(limit as (typeof LIMIT_OPTIONS)[number])) return { ok: false, error: "Pick a limit from the list." };
  const { admin, row } = await memberRow(email);
  if (!row) return { ok: false, error: "That person isn't on the list any more." };
  if (row.role === "owner") return { ok: false, error: "The owner has no limit." };
  const { error } = await admin.from("app_members").update({ ai_limit_usd: limit }).eq("email", email);
  if (error) return { ok: false, error: "Couldn't save the limit. Try again." };
  return done("Limit saved.");
}

export async function setMemberPaused(rawEmail: string, paused: boolean): Promise<PeopleResult> {
  if (!(await ownerOnly())) return NOT_OWNER;
  const email = normEmail(rawEmail);
  const { admin, row } = await memberRow(email);
  if (!row) return { ok: false, error: "That person isn't on the list any more." };
  if (row.role === "owner") return { ok: false, error: "You can't pause the owner." };
  // Resume → active if they've signed in before, else back to invited.
  const status = paused ? "paused" : row.user_id ? "active" : "invited";
  const { error } = await admin.from("app_members").update({ status }).eq("email", email);
  if (error) return { ok: false, error: "Couldn't change that. Try again." };
  return done(paused ? "Paused. They can't open Xclr until you resume them." : "Resumed.");
}

export async function removeMember(rawEmail: string, confirm: string): Promise<PeopleResult> {
  if (!(await ownerOnly())) return NOT_OWNER;
  if (confirm.trim() !== "REMOVE") return { ok: false, error: "Type REMOVE in capitals to confirm." };
  const email = normEmail(rawEmail);
  const { admin, row } = await memberRow(email);
  if (!row) return { ok: false, error: "That person isn't on the list any more." };
  if (row.role === "owner") return { ok: false, error: "You can't remove the owner." };
  const r = await deleteUserEverything(admin, { userId: (row.user_id as string | null) ?? null, email });
  if (!r.ok) return r;
  return done(`${email} was removed, with all their data.`);
}
