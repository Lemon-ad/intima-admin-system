import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type PushStatus = "loading" | "unsupported" | "denied" | "ready" | "subscribed";

async function getFreshRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  await reg?.update().catch(() => undefined);
  return reg;
}

export function usePushNotifications(memberId: string | null) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    try {
      const reg = await getFreshRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub && memberId) {
        // verify in DB
        const { data } = await supabase
          .from("push_subscriptions")
          .select("id, member_id")
          .eq("endpoint", sub.endpoint)
          .maybeSingle();
        if (data?.member_id === memberId) {
          setStatus("subscribed");
          return;
        }
      }
      setStatus("ready");
    } catch {
      setStatus("ready");
    }
  }, [memberId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    if (!memberId) return;
    setBusy(true);
    try {
      // Register SW
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await reg.update().catch(() => undefined);
      await navigator.serviceWorker.ready;

      // Permission
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "ready");
        toast.error("Notification permission denied");
        return;
      }

      // Get VAPID public key
      const { data: vapid, error: vapidErr } = await supabase.functions.invoke("push-vapid");
      if (vapidErr || !vapid?.public_key) throw new Error("Could not load notification key");

      // Subscribe
      let sub = await reg.pushManager.getSubscription();
      const currentKey = sub?.options.applicationServerKey
        ? btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "")
        : null;
      if (sub && currentKey && currentKey !== vapid.public_key) {
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid.public_key) as BufferSource,
        });
      }

      const json = sub.toJSON();
      const { error } = await supabase.functions.invoke("push-subscribe", {
        body: {
          member_id: memberId,
          subscription: json,
          user_agent: navigator.userAgent,
        },
      });
      if (error) throw error;
      setStatus("subscribed");
      toast.success("Notifications enabled! 🔔");
    } catch (e: unknown) {
      toast.error("Failed to enable notifications: " + getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [memberId]);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await getFreshRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.functions.invoke("push-subscribe", {
          body: { action: "unsubscribe", subscription: { endpoint: sub.endpoint } },
        });
        await sub.unsubscribe();
      }
      setStatus("ready");
      toast.success("Notifications disabled");
    } catch (e: unknown) {
      toast.error("Failed: " + getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, subscribe, unsubscribe, refresh };
}
