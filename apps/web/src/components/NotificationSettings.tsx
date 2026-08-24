"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

export function NotificationSettings({ telegramEnabled }: { telegramEnabled: boolean }) {
  const supabase = createClient();

  const [enabled, setEnabled] = useState(telegramEnabled);
  const [pending, setPending] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // While waiting on the user to hit Start in Telegram, poll for the
  // worker's bot to have confirmed the link, rather than making them
  // manually refresh the dashboard.
  useEffect(() => {
    if (!linkUrl || enabled) return;
    const interval = setInterval(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("telegram_enabled")
        .eq("id", user.id)
        .maybeSingle();
      if (data?.telegram_enabled) {
        setEnabled(true);
        setLinkUrl(null);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [linkUrl, enabled, supabase]);

  async function connectTelegram() {
    setError(null);

    if (!BOT_USERNAME) {
      setError("Telegram bot isn't configured yet (missing NEXT_PUBLIC_TELEGRAM_BOT_USERNAME).");
      return;
    }

    setPending(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return;
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("profiles")
      .update({ telegram_link_token: token, telegram_link_token_expires_at: expiresAt })
      .eq("id", user.id);

    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }

    const url = `https://t.me/${BOT_USERNAME}?start=${token}`;
    setLinkUrl(url);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function disconnectTelegram() {
    setPending(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ telegram_chat_id: null, telegram_enabled: false })
      .eq("id", user.id);

    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEnabled(false);
  }

  return (
    <div className="mt-4 rounded-lg border border-border-subtle bg-bg-surface p-5">
      <h2 className="mb-3 font-display text-sm font-semibold tracking-tight text-text-primary">Notifications</h2>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-primary">Telegram</p>
          <p className="text-xs text-text-muted">
            {enabled ? "Connected" : linkUrl ? "Waiting for confirmation..." : "Not connected"}
          </p>
        </div>
        {enabled ? (
          <button
            type="button"
            onClick={disconnectTelegram}
            disabled={pending}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-bearish disabled:opacity-50"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={connectTelegram}
            disabled={pending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg-base transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Connect Telegram
          </button>
        )}
      </div>

      {linkUrl && (
        <p className="mt-2 text-xs text-text-muted">
          Opened Telegram, if it didn&apos;t open,{" "}
          <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            tap here
          </a>
          , then press Start in the chat.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-bearish">{error}</p>}
    </div>
  );
}
