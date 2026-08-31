import type { CSSProperties } from "react";

interface PostThumbProps {
  /** Signed still, or null when there is nothing to show. */
  url: string | null;
  /** Sizing. The queue uses "row"; a card gets the slightly larger "card". */
  size?: "row" | "card";
}

/**
 * A small 9:16 still that identifies one post.
 *
 * IT IS AN IDENTITY STRIP, NOT A PREVIEW. The owner-side polish pass landed on
 * this framing after a first attempt rendered bare thumbnails with the text in
 * a `title` tooltip — which does not exist on a phone, and a 32px crop of a
 * vertical video is unrecognisable anyway. The real preview is one tap away on
 * the post itself; this only has to say "that one, the one with the blue
 * awning" faster than a line of caption text can.
 *
 * Never cropped to square (spec §3.9): the box is 9:16 and the image is
 * `object-fit: cover` inside it, which is a crop of the FRAME, not a change of
 * aspect ratio.
 *
 * A null url renders the muted placeholder rather than nothing, so a post
 * whose media is unavailable keeps its shape in the list instead of jumping
 * the row layout.
 *
 * `<img>` and not `next/image`: these are signed, one-hour, single-use URLs on
 * two different remote hosts (Supabase Storage and a Cloudflare Stream
 * subdomain). Routing them through the optimizer would mean whitelisting both
 * hosts and caching a credentialed URL in Vercel's image cache.
 */
export function PostThumb({ url, size = "row" }: PostThumbProps) {
  const width = size === "row" ? 34 : 44;
  const style: CSSProperties = {
    width,
    height: Math.round((width * 16) / 9),
    flex: "0 0 auto",
    backgroundColor: "var(--surface-base)",
    border: "1px solid var(--border)",
    overflow: "hidden",
  };

  if (!url) return <div aria-hidden="true" style={style} />;

  return (
    <div aria-hidden="true" style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
