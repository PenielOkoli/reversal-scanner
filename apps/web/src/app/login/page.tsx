"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const { error } =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setPending(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (mode === "sign-up") {
      setError("Check your email to confirm your account, then sign in.");
      setMode("sign-in");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text-primary">
            Reversal Scanner
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Staged double top / double bottom signals across your watchlist.
          </p>
        </div>

        <div className="rounded-lg border border-border-subtle bg-bg-surface p-6">
          <div className="mb-6 flex rounded-md border border-border-subtle bg-bg-base p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode("sign-in")}
              className={`flex-1 rounded px-3 py-1.5 transition-colors ${
                mode === "sign-in" ? "bg-bg-surface-raised text-text-primary" : "text-text-muted"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("sign-up")}
              className={`flex-1 rounded px-3 py-1.5 transition-colors ${
                mode === "sign-up" ? "bg-bg-surface-raised text-text-primary" : "text-text-muted"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-text-muted">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-text-muted">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              />
            </div>

            {error && <p className="text-sm text-bearish">{error}</p>}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-bg-base transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
