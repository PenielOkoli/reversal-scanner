"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

export function NotificationSettings({
  telegramEnabled,
  pushEnabled,
}: {
  telegramEnabled: boolean;
  pushEnabled: boolean;
}) {
  const supabase = createClient();

  const [tgEnabled, setTgEnabled] = useState(telegramEnabled);
  const [tgPending, setTgPending] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);

  const [pushOn, setPushOn] = useState(pushEnabled);
  const [pushPending, setPushPending] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  // While waiting on the user to hit Start in Telegram, poll for the
  // worker's bot to have confirmed the link, rather than making them
  // manually refresh the dashboard.
  useEffect(() => {
    if (!linkUrl || tgEnabled) return;
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
        setTgEnabled(true);
        setLinkUrl(null);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [linkUrl, tgEnabled, supabase]);

  async function connectTelegram() {
    setTgError(null);
    if (!BOT_USERNAME) {
      setTgError("Telegram bot isn't configured yet (missing NEXT_PUBLIC_TELEGRAM_BOT_USERNAME).");
      return;
    }

    setTgPending(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTgPending(false);
      return;
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("profiles")
      .update({ telegram_link_token: token, telegram_link_token_expires_at: expiresAt })
      .eq("id", user.id);

    setTgPending(false);
    if (error) {
      setTgError(error.message);
      return;
    }

    const url = `https://t.me/${BOT_USERNAME}?start=${token}`;
    setLinkUrl(url);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function disconnectTelegram() {
    setTgPending(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTgPending(false);
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ telegram_chat_id: null, telegram_enabled: false })
      .eq("id", user.id);
    setTgPending(false);
    if (error) {
      setTgError(error.message);
      return;
    }
    setTgEnabled(false);
  }

  async function enablePush() {
    setPushError(null);
    setPushPending(true);
    try {
      const subscriptionJson = await subscribeToPush();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setPushPending(false);
        return;
      }
      const { error } = await supabase
        .from("profiles")
        .update({ push_subscription: subscriptionJson, push_enabled: true })
        .eq("id", user.id);
      setPushPending(false);
      if (error) {
        setPushError(error.message);
        return;
      }
      setPushOn(true);
    } catch (err) {
      setPushPending(false);
      setPushError(err instanceof Error ? err.message : "Failed to enable push notifications.");
    }
  }

  async function disablePush() {
    setPushPending(true);
    await unsubscribeFromPush();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPushPending(false);
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ push_subscription: null, push_enabled: false })
      .eq("id", user.id);
    setPushPending(false);
    if (error) {
      setPushError(error.message);
      return;
    }
    setPushOn(false);
  }

  return (
    <div className="mt-4 rounded-lg border border-border-subtle bg-bg-surface p-5">
      <h2 className="mb-3 font-display text-sm font-semibold tracking-tight text-text-primary">Notifications</h2>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-primary">Telegram</p>
          <p className="text-xs text-text-muted">
            {tgEnabled ? "Connected" : linkUrl ? "Waiting for confirmation..." : "Not connected"}
          </p>
        </div>
        {tgEnabled ? (
          <button
            type="button"
            onClick={disconnectTelegram}
            disabled={tgPending}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-bearish disabled:opacity-50"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={connectTelegram}
            disabled={tgPending}
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
      {tgError && <p className="mt-2 text-xs text-bearish">{tgError}</p>}

      <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-4">
        <div>
          <p className="text-sm text-text-primary">Browser push</p>
          <p className="text-xs text-text-muted">{pushOn ? "Enabled" : "Not enabled"}</p>
        </div>
        {pushOn ? (
          <button
            type="button"
            onClick={disablePush}
            disabled={pushPending}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-bearish disabled:opacity-50"
          >
            Disable
          </button>
        ) : (
          <button
            type="button"
            onClick={enablePush}
            disabled={pushPending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg-base transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Enable push
          </button>
        )}
      </div>
      {pushError && <p className="mt-2 text-xs text-bearish">{pushError}</p>}
    </div>
  );
}
