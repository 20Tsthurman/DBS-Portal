"use client";

/**
 * The bridge between the Stream player iframe and the moments section of the
 * request-changes form (deck Screen 3, "Notes on moments").
 *
 * WHY THIS EXISTS. The player is a cross-origin Cloudflare iframe, so the DOM
 * cannot read its `currentTime`. Cloudflare's Stream Player SDK can: it wraps
 * an existing iframe element and speaks postMessage with the player inside,
 * streaming `timeupdate` events and property state out to the parent page.
 * Verified against this portal's production embeds on 2026-08-31 — customer
 * subdomain, signed-token URL, full query-param set — handshake, events,
 * advancing `currentTime`, and pause-position reads all work.
 *
 * TWO RULES FROM THAT VERIFICATION, both load-bearing:
 *
 *   1. ATTACH BEFORE THE PLAYER LOADS. The player posts its `iframeReady`
 *      handshake exactly once, when the embed boots. An SDK instance attached
 *      to an iframe whose player already booted hears nothing, forever, with
 *      no error — the failure mode is total silence. So the SDK script is
 *      loaded BEFORE the iframe is mounted (see `PostMedia`: play waits on
 *      `ensureStreamSdk` alongside the URL mint), and `attachPositionTracking`
 *      runs in the effect of the same commit that mounts the iframe — always
 *      ahead of the player's own network boot.
 *
 *   2. READ-ONLY. The SDK can command the player (play, pause, seek); nothing
 *      here does. Playback belongs to the client through the player's own
 *      controls — this module only listens. If a command is ever needed,
 *      revisit rule 1 first: commands queue until the handshake completes.
 *
 * The position itself lives in a module-level store read via
 * `useSyncExternalStore` (the `videoUpload.ts` idiom), because the component
 * that owns the iframe (`PostMedia`) and the component that needs the
 * timecode (the request-changes panel) are siblings under a server-rendered
 * page — there is no shared client parent to lift state into, and creating
 * one would pull the whole post page into client JS for one number.
 *
 * FAILURE IS COSMETIC BY DESIGN: if the SDK script cannot load, playback is
 * untouched (the iframe mounts regardless) and the moments section simply
 * keeps showing its "Play the video, then pause where you want to point"
 * helper — `hasPosition` never goes true. No error state exists because none
 * is actionable by a client.
 */

/** The subset of the SDK's player object this module touches. */
interface StreamPlayerSdkInstance {
  currentTime: number;
  addEventListener(name: string, handler: () => void): void;
  removeEventListener(name: string, handler: () => void): void;
  /** Removes the SDK's window-level message/click listeners. */
  destroy(): void;
}

declare global {
  interface Window {
    /** Installed by Cloudflare's sdk.latest.js — absent until it loads. */
    Stream?: (iframe: HTMLIFrameElement) => StreamPlayerSdkInstance;
  }
}

/**
 * Cloudflare's canonical SDK URL. `latest` rather than a pinned version is
 * their documented embed form — the SDK has no versioned URL scheme to pin.
 */
const STREAM_SDK_URL = "https://embed.cloudflarestream.com/embed/sdk.latest.js";

let sdkPromise: Promise<boolean> | null = null;

/**
 * Load the Stream Player SDK once, resolving `true` when `window.Stream`
 * exists. Resolves `false` — never rejects — on failure, and clears the
 * cached promise so a later press retries instead of remembering one bad
 * network moment for the life of the page.
 */
export function ensureStreamSdk(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (typeof window.Stream === "function") return Promise.resolve(true);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = STREAM_SDK_URL;
      script.async = true;
      script.onload = () => resolve(typeof window.Stream === "function");
      script.onerror = () => {
        sdkPromise = null;
        script.remove();
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

export interface PlayerPosition {
  /** The asset whose player produced this position; null = no position. */
  assetId: string | null;
  seconds: number;
  /**
   * True once the current video has reported at least one `timeupdate` —
   * i.e. the client has actually played it. The deck's rule hangs off this:
   * the "Add a note at 0:12" button exists only while `hasPosition`, and the
   * "Play the video, then pause where you want to point" helper otherwise.
   */
  hasPosition: boolean;
}

const NO_POSITION: PlayerPosition = {
  assetId: null,
  seconds: 0,
  hasPosition: false,
};

let current: PlayerPosition = NO_POSITION;
const listeners = new Set<() => void>();

function emit(next: PlayerPosition) {
  current = next;
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore` subscribe. */
export function subscribePlayerPosition(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `useSyncExternalStore` snapshot. A new object per update, so React sees it. */
export function getPlayerPositionSnapshot(): PlayerPosition {
  return current;
}

/** Server snapshot: there is never a position during SSR. */
export function getPlayerPositionServerSnapshot(): PlayerPosition {
  return NO_POSITION;
}

/**
 * Wrap a freshly mounted player iframe and stream its position into the
 * store. Returns the detach function; run it when the iframe unmounts or the
 * slide changes, so a note can never be stamped with a position left over
 * from a different video.
 *
 * Position updates on `timeupdate` (~4/s while playing — the deck's live
 * button timecode) and on `pause`, which freezes the store at exactly the
 * frame the client paused on: the moments flow. No-op when the SDK is not
 * loaded — see the module docblock for why that is deliberately silent.
 */
export function attachPositionTracking(
  iframe: HTMLIFrameElement,
  assetId: string
): () => void {
  const Stream = typeof window === "undefined" ? undefined : window.Stream;
  if (typeof Stream !== "function") return () => {};

  const player = Stream(iframe);
  const update = () => {
    emit({ assetId, seconds: player.currentTime, hasPosition: true });
  };
  player.addEventListener("timeupdate", update);
  player.addEventListener("pause", update);

  return () => {
    player.removeEventListener("timeupdate", update);
    player.removeEventListener("pause", update);
    player.destroy();
    // Only clear a position this player wrote — a detach racing a newer
    // slide's attach must not wipe the newer video's position.
    if (current.assetId === assetId) emit(NO_POSITION);
  };
}
