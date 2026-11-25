import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// One auth round trip per page load: the (app) layout, nested layouts and the
// page all ask "who is signed in?" — React's per-request cache answers the
// second and third time without another trip to Supabase.
export const getCurrentUser = cache(async () => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
