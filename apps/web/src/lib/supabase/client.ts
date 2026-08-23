import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client, used in client components. Reads/writes go
// through RLS as the logged-in user, never the service role key.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
