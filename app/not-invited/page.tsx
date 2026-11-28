import { getCurrentUser } from "@/lib/session";
import { getAccess, isEmail, normEmail } from "@/lib/access";
import { XclrMark } from "@/components/auth/xclr-mark";
import { SwitchAccountButton } from "@/components/auth/switch-account-button";

export const metadata = { title: "Invite only · Xclr" };

// Shown when a Google account isn't on the invite list (or was paused).
// Public path (middleware). The email comes from the session when there is
// one, else from ?e= — validated, and rendered as text (React escapes it).
export default async function NotInvitedPage({
  searchParams,
}: {
  searchParams: { e?: string | string[]; p?: string | string[] };
}) {
  const user = await getCurrentUser();
  const access = user ? await getAccess(user).catch(() => null) : null;
  const paused = access ? access.status === "paused" : searchParams.p === "1";
  const fromQuery = normEmail(Array.isArray(searchParams.e) ? searchParams.e[0] : searchParams.e);
  const email = normEmail(user?.email) || (isEmail(fromQuery) ? fromQuery : "");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3.5 px-6">
      <XclrMark />
      <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] text-ink">
        {paused ? "Your Xclr access is paused" : "Xclr is invite-only for now"}
      </h1>
      <p className="text-[15px] leading-normal text-band-secondary">
        {paused ? (
          <>
            {email ? (
              <>
                <strong className="break-all text-ink">{email}</strong> is paused right now.
              </>
            ) : (
              <>This account is paused right now.</>
            )}{" "}
            Ask Dave to resume it, then sign in again.
          </>
        ) : email ? (
          <>
            You signed in as <strong className="break-all text-ink">{email}</strong>, which isn&apos;t on the invite
            list.
          </>
        ) : (
          <>That Google account isn&apos;t on the invite list.</>
        )}
        {paused ? null : " Ask Dave to add this email, then sign in again."}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <SwitchAccountButton />
      </div>
      <p className="text-xs text-muted">
        {paused ? "Everything you logged is kept while you're paused." : "Nothing about you was saved."}
      </p>
    </main>
  );
}
