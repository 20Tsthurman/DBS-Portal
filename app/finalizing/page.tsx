"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUser, useClerk } from "@clerk/nextjs";

const POLL_INTERVAL_MS = 500;
// Clerk's session refresh is asynchronous: an invited user's
// publicMetadata can be empty for ~1-3s after signup while the session
// token catches up. 5s leaves comfortable headroom for the legitimate
// case while still rejecting OAuth-fresh users (whose publicMetadata
// stays empty forever — they were never invited) without a long wait.
const TIMEOUT_MS = 5_000;

export default function FinalizingPage() {
  const router = useRouter();
  const { isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const startedAtRef = useRef<number | null>(null);
  const rejectedRef = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    if (rejectedRef.current) return;

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

    // No role yet. Two reasons this can happen:
    //   (a) Invited user, Clerk session not refreshed yet — publicMetadata
    //       will populate within ~1-3s. Keep polling.
    //   (b) Uninvited OAuth user (e.g. "Continue with Google" on /sign-in
    //       with a never-invited Google account). Clerk creates the user
    //       directly, bypassing the /sign-up page-level invite guard, and
    //       sends them here via NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL.
    //       publicMetadata stays empty forever. After TIMEOUT_MS, sign
    //       them out and bounce to /sign-in with a clear message.
    if (Date.now() - startedAtRef.current >= TIMEOUT_MS) {
      rejectedRef.current = true;
      void signOut().finally(() => {
        router.replace("/sign-in?error=not_invited");
      });
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
  }, [isLoaded, user, router, signOut]);

  return (
    <main
      className="flex min-h-dvh items-center justify-center px-6 py-8"
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
          Finalizing your account…
        </h1>
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
      </div>
    </main>
  );
}
