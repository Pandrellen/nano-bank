"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshSessionAction, type RefreshResult } from "@/actions/auth";
import { REFRESH_LEAD_MS } from "@/lib/config";

// Module-level, not per-instance: the refresh token is single-use, so two
// concurrent refreshes (React StrictMode's dev double-mount, or more than one
// TokenCountdown mounted at once) race to present it — the loser gets a 401
// and its cookies wiped even though the session was fine. Sharing one
// in-flight promise across all callers in this page's JS runtime collapses
// concurrent calls into a single request. Same root cause as the multi-tab
// issue in the README, just one scope narrower — a module-level promise
// doesn't cover separate tabs, each of which gets its own JS runtime.
let inFlightRefresh: Promise<RefreshResult> | null = null;

function refreshSessionOnce(): Promise<RefreshResult> {
  if (!inFlightRefresh) {
    inFlightRefresh = refreshSessionAction().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function TokenCountdown({ expiresAt }: { expiresAt: number }) {
  const router = useRouter();
  const [expiry, setExpiry] = useState(expiresAt);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    const tick = async () => {
      const msLeft = expiry * 1000 - Date.now();
      setRemaining(msLeft);

      if (msLeft <= REFRESH_LEAD_MS && !refreshInFlight.current) {
        refreshInFlight.current = true;
        setIsRefreshing(true);

        let result: RefreshResult;
        try {
          result = await refreshSessionOnce();
        } catch (error) {
          console.error("Token refresh failed:", error);
          result = { status: "error" };
        }

        if (result.status === "refreshed") {
          if (result.expiresAt) {
            setExpiry(result.expiresAt);
          }
          setIsRefreshing(false);
          refreshInFlight.current = false;
        } else if (result.status === "unauthorized") {
          router.push("/auth/signin");
        } else {
          // Transient failure (network/5xx) — session may still be fine, so
          // don't sign the user out. Stay in the refreshing state and retry
          // on the next tick.
          refreshInFlight.current = false;
        }
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiry, router]);

  if (remaining === null) return null;

  if (isRefreshing) {
    return <span className="text-slate-400">Refreshing session…</span>;
  }

  return (
    <span className={remaining <= 0 ? "text-red-400" : "text-slate-400"}>
      Session expires in {formatRemaining(remaining)}
    </span>
  );
}
