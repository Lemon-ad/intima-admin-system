import { useState } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface Props {
  memberId: string | null;
  memberName?: string;
}

const isIOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1));
const isStandalone =
  typeof window !== "undefined" &&
  // @ts-ignore
  (window.navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches);

export default function EnableNotificationsButton({ memberId, memberName }: Props) {
  const { status, busy, subscribe, unsubscribe } = usePushNotifications(memberId);
  const [showHelp, setShowHelp] = useState(false);

  if (!memberId) return null;

  if (status === "loading") return null;

  if (status === "unsupported") {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        🔕 Notifications not supported on this browser.
        {isIOS &&
          (isStandalone
            ? " If this is the Home Screen app, delete the old shortcut and add it again from Safari after publishing this update."
            : " On iPhone, open the published site in Safari, then add to Home Screen first (Share → Add to Home Screen).")}
      </div>
    );
  }

  if (isIOS && !isStandalone) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
        <p className="font-medium text-amber-700 dark:text-amber-400">📱 iPhone setup required</p>
        <p className="mt-1 text-muted-foreground">
          To get notifications on iPhone:
        </p>
        <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-muted-foreground">
          <li>Open this site in <b>Safari</b></li>
          <li>Tap the <b>Share</b> icon ⬆️</li>
          <li>Tap <b>"Add to Home Screen"</b></li>
          <li>Open the app from home screen</li>
          <li>Then tap "Enable Notifications" here</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {status === "subscribed" ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Notifications ON for {memberName || "you"}
            </span>
            <button
              onClick={unsubscribe}
              disabled={busy}
              className="rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              Turn off
            </button>
          </>
        ) : (
          <button
            onClick={subscribe}
            disabled={busy}
            className="rounded-md border border-primary bg-primary/10 text-primary px-3 py-1.5 text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {busy ? "Setting up..." : `🔔 Enable Notifications${memberName ? ` for ${memberName}` : ""}`}
          </button>
        )}
        <button
          onClick={() => setShowHelp((v) => !v)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {showHelp ? "Hide" : "How does this work?"}
        </button>
      </div>
      {status === "denied" && (
        <p className="text-xs text-destructive">
          Notifications blocked. Enable them in your browser settings, then reload.
        </p>
      )}
      {showHelp && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          <p>📲 Reminders pop up before each duty slot — even when this site is closed.</p>
          <p>⏰ Admin sets reminder times (e.g. 1 day before, 15 min before).</p>
          <p>🔒 Per-device — enable on each phone/laptop you use.</p>
          <p>🍎 On iPhone, the site must be added to home screen first.</p>
        </div>
      )}
    </div>
  );
}
