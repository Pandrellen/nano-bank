"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshSessionAction } from "../actions/auth";

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

      if (msLeft <= 0 && !refreshInFlight.current) {
        refreshInFlight.current = true;
        setIsRefreshing(true);

        let result;
        try {
          result = await refreshSessionAction();
        } catch (error) {
          console.error("Token refresh failed:", error);
          result = { success: false as const };
        }

        if (result.success && result.expiresAt) {
          setExpiry(result.expiresAt);
          setIsRefreshing(false);
          refreshInFlight.current = false;
        } else {
          router.push("/auth/signin");
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
