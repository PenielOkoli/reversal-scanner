"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  return (
    <button
      type="button"
      onClick={async () => {
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="rounded-md border border-border-subtle px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
    >
      Sign out
    </button>
  );
}
