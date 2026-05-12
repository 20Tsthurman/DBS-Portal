"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";

const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 15_000;

export default function FinalizingPage() {
  const router = useRouter();
  const { isLoaded, user } = useUser();
  const startedAtRef = useRef<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    if (timedOut) return;

    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }

    const role = user.publicMetadata?.role as string | undefined;
    if (role === "client") {
      router.replace("/client/dashboard");
      return;
    }
    if (role === "owner") {
      router.replace("/owner/dashboard");
      return;
    }

    if (Date.now() - startedAtRef.current >= TIMEOUT_MS) {
      setTimedOut(true);
      return;
    }

    // No role yet — schedule one reload, then let the effect re-run when
    // useUser surfaces the updated user object.
    const t = setTimeout(() => {
      user.reload().catch(() => {
        // ignore — try again on next tick
      });
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [isLoaded, user, router, timedOut]);

  return (
    <main
      className="flex min-h-screen items-center justify-center px-6 py-16"
      style={{ backgroundColor: "var(--sidebar-bg)" }}
    >
      <div
        className="w-full max-w-md border px-10 py-12 text-center"
        style={{
          backgroundColor: "var(--surface-base)",
          borderColor: "var(--border)",
        }}
      >
        <p
          className="mb-3"
          style={{
            color: "var(--text-muted)",
            fontSize: "11px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          Client Portal
        </p>
        <h1
          className="mb-3"
          style={{
            fontFamily: "var(--font-playfair), serif",
            color: "var(--text-primary)",
            fontSize: "28px",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {timedOut ? "We're still working on it" : "Finalizing your account…"}
        </h1>

        {!timedOut ? (
          <>
            <p
              className="mb-8"
              style={{
                color: "var(--text-body)",
                fontSize: "13px",
                lineHeight: 1.6,
              }}
            >
              This will only take a moment.
            </p>
            <div className="flex justify-center" aria-hidden="true">
              <div
                className="animate-spin"
                style={{
                  width: 32,
                  height: 32,
                  border: "2px solid var(--border)",
                  borderTopColor: "var(--accent)",
                  borderRadius: "50%",
                }}
              />
            </div>
            <span className="sr-only">Finishing account setup</span>
          </>
        ) : (
          <>
            <p
              className="mb-6"
              style={{
                color: "var(--text-body)",
                fontSize: "13px",
                lineHeight: 1.6,
              }}
            >
              Something’s taking longer than expected. Please refresh, or
              contact Kelsey if this persists.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: "var(--accent)",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "12px 22px",
                border: "none",
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </>
        )}
      </div>
    </main>
  );
}
