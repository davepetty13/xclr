import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getAccess, type Access } from "@/lib/access";
import { OWNER_USER_ID } from "@/lib/owner";
import { XclrMark } from "@/components/auth/xclr-mark";
import { DeleteMyData } from "@/components/app/delete-my-data";

export const metadata = { title: "Delete my data · Xclr" };

// A paused member can't open the app, but can still delete their data here.
// Middleware lets paused people reach only this page (GET) and POST
// /leave/delete. Everyone else is sent where they belong.
export default async function LeavePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let access: Access | null = null;
  let failed = false;
  try {
    access = await getAccess(user);
  } catch {
    failed = true;
  }

  if (!failed) {
    if (user.id === OWNER_USER_ID || access?.role === "owner") redirect("/profile");
    if (access?.status === "active") redirect("/profile");
    if (access?.status !== "paused") redirect("/not-invited");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3.5 px-6">
      <XclrMark />
      <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] text-ink">Delete my data</h1>
      {failed ? (
        <p className="text-[15px] leading-normal text-band-secondary">
          Xclr couldn&apos;t check your access just now. Try again in a minute.
        </p>
      ) : (
        <>
          <p className="text-[15px] leading-normal text-band-secondary">
            Your access is paused, but your data is yours. You can delete everything you logged in Xclr and your
            account here.
          </p>
          <DeleteMyData endpoint="/leave/delete" />
        </>
      )}
    </main>
  );
}
