"use client";

import { useEffect, useRef, useState } from "react";
import { MediaError } from "./MediaError";
import { carouselCounter } from "../_lib/copy";
import { createReviewPlaybackAction } from "../_actions";
import {
  attachPositionTracking,
  ensureStreamSdk,
} from "../_lib/playerPosition";
import type { ReviewSlide } from "../_lib/slides";

interface PostMediaProps {
  slides: ReviewSlide[];
}

/**
 * The post's media: one 9:16 frame, with carousel controls when there is more
 * than one slide.
 *
 * ALWAYS 9:16, NEVER CROPPED (spec 3.9). The frame is `aspect-ratio: 9 / 16`
 * and the image inside is `object-fit: contain`, not `cover` - this is the
 * client's actual post, so a crop of it would be a lie about what goes out.
 * (The queue's thumbnail uses `cover`, which is fine: that one is an identity
 * strip, not a preview.)
 *
 * VIDEO IS MINTED ON PRESS. The server hands this component a poster frame
 * only; the player URL is fetched by `createReviewPlaybackAction` when the
 * client presses play, so the token is seconds old rather than up to an hour.
 * A cross-origin iframe cannot report an expired token - it just shows
 * nothing - so the expiry is designed out rather than handled.
 *
 * The iframe is mounted only while playing, so leaving a slide or the page
 * stops the audio. There is no hidden player left running.
 *
 * THE PLAYER'S POSITION IS PUBLISHED, not owned. The moments section of the
 * request-changes form needs "where the client paused", and this component
 * has the only handle on the player. `attachPositionTracking` wraps each
 * freshly mounted iframe with Cloudflare's player SDK and streams
 * timeupdate/pause positions into the `playerPosition` store; the form reads
 * the store. Two ordering rules from the SDK verification (2026-08-31), both
 * enforced here: the SDK script must be loaded BEFORE the iframe mounts
 * (play awaits it beside the URL mint — a late attach misses the player's
 * one-shot handshake and hears nothing forever), and the attach itself runs
 * in the effect of the mounting commit. An SDK that fails to load costs only
 * the moments timecode, never playback: the iframe mounts regardless.
 */
export function PostMedia({ slides }: PostMediaProps) {
  const [index, setIndex] = useState(0);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);
  const [brokenImages, setBrokenImages] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const slide = slides[index];
  const slideAssetId = slide?.assetId ?? null;

  // Moving between slides tears down the player. Without this, stepping past a
  // playing video leaves its audio running under a photo.
  useEffect(() => {
    setIframeUrl(null);
    setPending(false);
    setPlayFailed(false);
  }, [index]);

  // Start the SDK download the moment a video post renders, so it has long
  // finished by the first press and the play path never actually waits on it.
  useEffect(() => {
    if (slides.some((s) => s.kind === "video")) void ensureStreamSdk();
  }, [slides]);

  // Wrap the just-mounted iframe. Keyed on iframeUrl: minting a fresh URL is
  // the only way an iframe mounts, and the cleanup runs before the next
  // attach or on unmount — a note can never carry a stale video's position.
  useEffect(() => {
    if (!iframeUrl || !slideAssetId) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    return attachPositionTracking(iframe, slideAssetId);
  }, [iframeUrl, slideAssetId]);

  if (!slide) return null;

  const total = slides.length;
  const isCarousel = total > 1;
  const imageBroken = brokenImages.includes(slide.assetId);

  const handlePlay = async () => {
    if (pending) return;
    setPlayFailed(false);
    setPending(true);
    // The SDK races the mint, not the client: it must be resident BEFORE the
    // iframe mounts (see the component docblock), and `false` — script
    // unreachable — deliberately does not block playback.
    const [result] = await Promise.all([
      createReviewPlaybackAction(slide.assetId),
      ensureStreamSdk(),
    ]);
    setPending(false);
    if (!result.ok || !result.data) {
      setPlayFailed(true);
      return;
    }
    setIframeUrl(result.data.iframeUrl);
  };

  const showError =
    playFailed || slide.url === null || (slide.kind === "image" && imageBroken);

  return (
    <div className="rvw-media">
      <div className="rvw-frame">
        {showError ? (
          <MediaError kind={slide.kind} />
        ) : iframeUrl ? (
          <iframe
            ref={iframeRef}
            src={iframeUrl}
            title="Video"
            className="rvw-player"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
            allowFullScreen
          />
        ) : (
          <>
            {/* Dropped once it has failed to load, rather than left to render
                the browser's broken-image glyph. For a video that is cosmetic
                only: the play button below still works, because pressing it
                mints a FRESH token rather than reusing the poster's. */}
            {!imageBroken && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slide.url ?? ""}
                alt=""
                className="rvw-still"
                onError={() =>
                  setBrokenImages((prev) =>
                    prev.includes(slide.assetId)
                      ? prev
                      : [...prev, slide.assetId]
                  )
                }
              />
            )}
            {slide.kind === "video" && (
              <button
                type="button"
                onClick={handlePlay}
                disabled={pending}
                aria-label="Play video"
                className="rvw-play"
              >
                {pending ? (
                  <span className="rvw-play-text">Opening…</span>
                ) : (
                  <span aria-hidden="true" className="rvw-play-triangle" />
                )}
              </button>
            )}
          </>
        )}
      </div>

      {isCarousel && (
        <div className="rvw-carousel">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            aria-label="Previous"
            className="rvw-step"
          >
            ‹
          </button>
          <span className="rvw-counter">
            {carouselCounter(index + 1, total)}
          </span>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            disabled={index === total - 1}
            aria-label="Next"
            className="rvw-step"
          >
            ›
          </button>
        </div>
      )}

      {/* Component-scoped classes rather than inline styles: the frame needs a
          real media query for its desktop height cap, which inline styles
          cannot express. Same <style> idiom the owner playback overlay uses.
          Sharp corners and no shadows come free from the global reset. */}
      <style>{`
        .rvw-media {
          width: 100%;
        }
        .rvw-frame {
          position: relative;
          width: 100%;
          aspect-ratio: 9 / 16;
          background-color: #132A1C; /* --sidebar-deep, so the box reads
                                        intentional while an image decodes */
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .rvw-still,
        .rvw-player {
          width: 100%;
          height: 100%;
          border: none;
          display: block;
        }
        /* contain, not cover: this is the post itself, shown whole. */
        .rvw-still {
          object-fit: contain;
        }
        .rvw-play {
          position: absolute;
          inset: 0;
          margin: auto;
          width: 72px;
          height: 72px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background-color: rgba(27, 56, 39, 0.86); /* --sidebar-bg */
          border: 1px solid rgba(242, 237, 228, 0.5);
          color: #F2EDE4;
          cursor: pointer;
        }
        .rvw-play:disabled {
          cursor: default;
        }
        .rvw-play-triangle {
          /* A CSS triangle rather than an icon font or an SVG import - one
             shape, no dependency. Nudged right so it looks centred. */
          display: block;
          margin-left: 5px;
          border-style: solid;
          border-width: 13px 0 13px 21px;
          border-color: transparent transparent transparent #F2EDE4;
        }
        .rvw-play-text {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .rvw-carousel {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-top: 12px;
        }
        .rvw-step {
          width: 48px;
          height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-primary);
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
        }
        .rvw-step:disabled {
          opacity: 0.35;
          cursor: default;
        }
        .rvw-counter {
          min-width: 64px;
          text-align: center;
          font-size: 13px;
          color: var(--text-muted);
        }
        @media (min-width: 900px) {
          .rvw-frame {
            /* Cap the height so the whole post and its actions are visible on
               a laptop without scrolling; width follows from the 9:16 ratio. */
            width: auto;
            height: min(560px, calc(100dvh - 220px));
            aspect-ratio: 9 / 16;
            margin: 0 auto;
          }
        }
      `}</style>
    </div>
  );
}
