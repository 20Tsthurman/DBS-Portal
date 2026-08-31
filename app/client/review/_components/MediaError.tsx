import Link from "next/link";
import type { CSSProperties } from "react";
import { MEDIA_ERROR } from "../_lib/copy";

interface MediaErrorProps {
  kind: "video" | "image";
  /** Cream-on-forest when it sits inside the media frame. */
  tone?: "onDark" | "onLight";
}

/**
 * "This video isn't loading right now. Refresh the page to try again, or
 * send Kelsey a message if it keeps happening."
 *
 * The link half is a real link to Messages, matching how Screen 5 treats the
 * same phrase in the declined and auto-approved states. It is the escape hatch
 * for the one failure the client cannot do anything about themselves.
 *
 * Deliberately says nothing about tokens, transcoding, or expiry. The client
 * has two useful moves - reload, or tell Kelsey - and the sentence names both.
 */
export function MediaError({ kind, tone = "onDark" }: MediaErrorProps) {
  const onDark = tone === "onDark";
  return (
    <p
      role="alert"
      style={{
        ...textStyle,
        color: onDark ? "rgba(242, 237, 228, 0.85)" : "var(--text-body)",
      }}
    >
      {kind === "video" ? MEDIA_ERROR.videoLead : MEDIA_ERROR.photoLead}{" "}
      {MEDIA_ERROR.beforeLink}
      <Link
        href="/client/messages"
        style={{
          ...linkStyle,
          color: onDark ? "#FFFFFF" : "var(--accent)",
        }}
      >
        {MEDIA_ERROR.linkText}
      </Link>
      {MEDIA_ERROR.afterLink}
    </p>
  );
}

const textStyle: CSSProperties = {
  margin: 0,
  padding: 20,
  textAlign: "center",
  fontSize: 13,
  lineHeight: 1.6,
};

const linkStyle: CSSProperties = {
  textDecoration: "underline",
  fontWeight: 600,
};
