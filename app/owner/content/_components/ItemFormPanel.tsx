"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import { UploadProgressIndicator } from "@/components/ui/UploadProgressIndicator";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  helperStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import type { Platform, PostFormat } from "@/lib/supabase";
import { dateKeyInTimezone } from "@/lib/date";
import { fullDateLabelForDateKey } from "@/app/owner/calendar/_lib/timezone";
import { useVisibilityPolling } from "@/lib/hooks/useVisibilityPolling";
import { RevisionRequestSection } from "./RevisionRequestSection";
import { VideoPlaybackOverlay } from "./VideoPlaybackOverlay";
import {
  createContentAssetPlaybackAction,
  createContentAssetUploadUrlAction,
  createContentItemAction,
  deleteContentAssetAction,
  fetchContentAssetPreviewsAction,
  finalizeContentAssetAction,
  updateContentItemAction,
} from "../_actions";
import type { AssetPreview } from "../_lib/assetPreviews";
import {
  FORMAT_LABELS,
  FORMAT_OPTIONS,
  PLATFORM_LABELS,
  PLATFORM_OPTIONS,
  defaultDateForMonth,
  timeInputValueInTimezone,
  timeLabelFromInputValue,
} from "../_lib/format";
import type { ContentItemWithAssets } from "../_lib/queries";
import {
  dismissVideoUpload,
  getVideoUploadServerSnapshot,
  getVideoUploadSnapshot,
  resumeVideoUploadWithFile,
  retryVideoUpload,
  startVideoUpload,
  subscribeVideoUpload,
  type VideoUploadState,
} from "../_lib/videoUpload";

interface ItemFormPanelProps {
  open: boolean;
  onClose: () => void;
  /** Present = edit; absent = create a new post in `cycleId`. */
  item: ContentItemWithAssets | null;
  cycleId: string | null;
  monthKey: string;
  /**
   * The board's active client — the playback overlay's headline for the one
   * case with no `item` to read `client_name` from: a post created this
   * session that had a video uploaded before any reopen. Empty only in the
   * all-clients view, where the panel always opens with an `item`.
   */
  clientName: string;
}

interface FormValues {
  date: string;
  time: string;
  platform: Platform;
  format: PostFormat;
  caption: string;
}

const DEFAULT_TIME = "09:00";

// Photos only this phase. Comfortably above any phone or mirrorless still,
// and well under the files feature's 50 MB ceiling, which has to carry video
// deliverables too.
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/**
 * Byte ceiling on a video, mirroring MAX_VIDEO_BYTES in _actions.ts.
 *
 * The server enforces it too — this copy exists only so a mis-picked file is
 * rejected before a tus upload is minted and a carousel slot is claimed.
 */
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/**
 * How often the panel asks whether a processing video has become playable.
 *
 * Six seconds, deliberately not the DEFAULT_POLL_INTERVAL_MS = 30_000 that all
 * four messages consumers use. That cadence is tuned for a person on the other
 * end who might reply at any point over hours; this one is tuned for a machine
 * finishing a job in seconds. Review clips run 6–15s (spec §3.5d) and
 * Cloudflare encodes at roughly real time, so the flip to ready usually lands
 * within a few seconds of the last byte. At 30s Kelsey would sit in front of a
 * "Processing" tile for up to half a minute after the video was already
 * playable — a stall in the exact place spec §3.5b says should be "largely
 * invisible to her".
 *
 * Not shorter than this. Below roughly 5s the encode is unlikely to have
 * finished anyway, so the extra requests buy no responsiveness and only spend
 * Cloudflare API calls.
 *
 * The cost is bounded by construction rather than by the interval: the poll
 * runs only while a video that is NOT currently uploading sits in 'processing'
 * inside an OPEN panel on a VISIBLE tab, and it stops the moment none does.
 * That is a few seconds of polling per upload, for one owner — not a
 * background ticker.
 */
const CONTENT_ASSET_POLL_INTERVAL_MS = 6_000;

/**
 * Where playback changes shape. At and above this width, pressing a video
 * tile widens the panel and seats the player beside the form; below it the
 * full-screen VideoPlaybackOverlay takes over (the panel is already
 * effectively full-width there, so widening has nothing to offer). MUST stay
 * equal to the overlay's own `@media (min-width: 900px)` breakpoint — the
 * two surfaces hand off to each other at exactly this line.
 */
const DESKTOP_PLAYBACK_QUERY = "(min-width: 900px)";

/** 520 fits the form (the invoices-panel width). */
const PANEL_WIDTH_PX = 520;
/**
 * Widened for playback: a ~360px player plus its gutter beside a slightly
 * slimmed form column — and still narrower than the 900px viewports that are
 * the smallest ever to use it, so the panel keeps reading as a panel.
 */
const PANEL_WIDTH_PLAYING_PX = 850;

/**
 * Player sizing, shared by the video box and the column that clips it:
 * ~360x640, shrunk on short screens so the whole player is visible without
 * scrolling — the overlay's sizing idiom with this surface's chrome (panel
 * header, sticky offset, player chrome rows) subtracted instead.
 */
const PLAYER_HEIGHT_CSS = "min(640px, 100dvh - 230px)";
const PLAYER_GUTTER_PX = 24;
/** The video's width follows from the 9:16 ratio; the gutter rides inside
 * the column so both collapse to zero together when playback closes. */
const PLAYER_COL_WIDTH_CSS = `calc((${PLAYER_HEIGHT_CSS}) * 9 / 16 + ${PLAYER_GUTTER_PX}px)`;

/**
 * Whether the viewport is wide enough for in-panel playback.
 *
 * State rather than the ref idiom `useCoarsePointer` documents, because this
 * value picks which playback surface renders. That is hydration-safe here
 * only because every render branch on it is also gated on `playingAssetId`,
 * which cannot be non-null until a press after mount — the server render and
 * the first client render never reach the branch.
 */
function useDesktopPlaybackViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(DESKTOP_PLAYBACK_QUERY);
    setIsDesktop(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

/**
 * What a tile says when it has no image.
 *
 * The tile for the video currently uploading reports the UPLOAD, not the
 * row's stored status. The row reads 'processing' from the moment it is
 * minted, so trusting it alone would print "Processing" over a tile whose
 * bytes are visibly still moving, and again over one whose upload has stopped
 * and needs her.
 */
function tileLabel(
  preview: AssetPreview,
  active: VideoUploadState | null
): string {
  if (active && active.assetId === preview.id) {
    if (active.phase === "paused") return "Upload paused";
    if (active.phase === "finalizing") return "Finishing";
    return "Uploading";
  }
  if (preview.kind !== "video") return "Photo unavailable";
  if (preview.status === "failed") return "Video failed";
  if (preview.status === "processing") return "Processing";
  return "Video";
}

function valuesFor(
  item: ContentItemWithAssets | null,
  monthKey: string
): FormValues {
  if (!item) {
    return {
      date: defaultDateForMonth(monthKey),
      time: DEFAULT_TIME,
      platform: "instagram",
      format: "reel",
      caption: "",
    };
  }
  const when = new Date(item.scheduled_for);
  return {
    date: dateKeyInTimezone(when),
    time: timeInputValueInTimezone(when),
    platform: item.platform,
    format: item.format,
    caption: item.caption ?? "",
  };
}

/**
 * XHR rather than `fetch` so real progress events are available — cloned from
 * the files feature's `uploadFileWithProgress`. If the panel closes or the
 * user navigates mid-upload the XHR aborts naturally and finalize is never
 * called, so no orphan row is written.
 */
function uploadFileWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    xhr.send(file);
  });
}

export function ItemFormPanel({
  open,
  onClose,
  item,
  cycleId,
  monthKey,
  clientName,
}: ItemFormPanelProps) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() =>
    valuesFor(item, monthKey)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A post must exist before photos can hang off it (content_assets FKs the
  // item). Creating flips this on without closing the panel, so Kelsey saves
  // once and keeps going straight into the photos.
  const [activeItemId, setActiveItemId] = useState<string | null>(
    item?.id ?? null
  );

  const [previews, setPreviews] = useState<AssetPreview[]>([]);
  const [previewsLoading, setPreviewsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [confirmDeleteAsset, setConfirmDeleteAsset] =
    useState<AssetPreview | null>(null);
  const [deletingAsset, setDeletingAsset] = useState(false);
  /** The asset playing in the full-screen overlay, if any. One at a time. */
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);
  /** Freshly minted iframe src; null while the mint is in flight. */
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  /**
   * A failed mint, shown inside the overlay rather than back in the panel:
   * the overlay opens on press (so the response feels immediate), which means
   * Kelsey is already looking at it when the error lands — closing it again
   * to point at a message beside the tile would read as a flicker.
   */
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  /** Copy-caption feedback for the in-panel player. The overlay owns its own
   * copy of this state; only one of the two surfaces exists at a time. */
  const [panelCopyState, setPanelCopyState] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const panelCopyTimerRef = useRef<number | null>(null);
  /**
   * What was focused when playback opened — the play tile. The overlay hands
   * focus back in its own unmount effect; the in-panel player has no unmount
   * hook of its own, so the close path restores from here instead.
   */
  const playbackOpenerRef = useRef<HTMLElement | null>(null);
  const isDesktopViewport = useDesktopPlaybackViewport();
  /** The breakpoint decides the surface: widened panel above 900px, the
   * full-screen overlay below it. */
  const playbackInPanel = playingAssetId !== null && isDesktopViewport;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * The asset the most recent play request was for. Two quick presses on
   * different tiles race, and without this the slower mint can land last and
   * drop the wrong video into the tile the user is actually looking at.
   */
  const playbackRequestRef = useRef<string | null>(null);
  /**
   * One free reload when a signed URL fails to load. Both photo URLs and
   * Stream posters live an hour, so a panel open longer than that shows broken
   * images until something re-mints them; `onError` is what notices, since
   * nothing else can. Latched so a genuinely missing object cannot turn a
   * failed image into a reload loop.
   */
  const staleUrlReloadRef = useRef(false);

  /**
   * The video upload lives in module scope, not in this component. It has to
   * outlive the panel: closing it, tapping another post, or navigating to
   * another owner page all unmount this tree, and any upload held in React
   * state would die mid-file with it. The panel is a subscriber here, never
   * the owner.
   */
  const uploadSnapshot = useSyncExternalStore(
    subscribeVideoUpload,
    getVideoUploadSnapshot,
    getVideoUploadServerSnapshot
  );

  /**
   * The upload only renders in the panel for the item it belongs to — and
   * only an ORDINARY upload. A replacement upload (Phase 6) carries
   * `replacesAssetId` and is the ReplacementSection's readout; showing it
   * here too would render one transfer as two competing progress bars.
   */
  const videoUpload =
    uploadSnapshot.active &&
    uploadSnapshot.active.itemId === activeItemId &&
    uploadSnapshot.active.replacesAssetId === null
      ? uploadSnapshot.active
      : null;

  // One video at a time, including one belonging to a different post — that
  // is the module's rule, and disabling the button says so before she picks a
  // file and gets an error back.
  const addVideoDisabled = uploading || uploadSnapshot.active !== null;

  const loadPreviews = useCallback(async (itemId: string) => {
    setPreviewsLoading(true);
    const result = await fetchContentAssetPreviewsAction(itemId);
    setPreviewsLoading(false);
    if (!result.ok || !result.data) {
      setMediaError(result.error ?? "Could not load media");
      return;
    }
    setPreviews(result.data);
  }, []);

  useEffect(() => {
    if (!open) return;
    setValues(valuesFor(item, monthKey));
    setActiveItemId(item?.id ?? null);
    setError(null);
    setMediaError(null);
    setPreviews([]);
    setUploadProgress(0);
    setPlayingAssetId(null);
    setPlaybackUrl(null);
    setPlaybackError(null);
    setPanelCopyState("idle");
    playbackRequestRef.current = null;
    playbackOpenerRef.current = null;
    staleUrlReloadRef.current = false;
    if (item) void loadPreviews(item.id);
  }, [open, item, monthKey, loadPreviews]);

  /**
   * The assets worth asking Cloudflare about.
   *
   * The video whose bytes are still moving is excluded even though its row
   * reads 'processing'. Cloudflare has not been handed a complete file yet, so
   * it can only answer `pendingupload`, and a 500 MB upload would spend
   * minutes generating one pointless API call every interval. Its tile is
   * already reporting the upload itself through `tileLabel`, and the finalize
   * call at the end of the upload takes the first reading.
   */
  const processingAssetIds = useMemo(
    () =>
      previews
        .filter((p) => p.status === "processing" && p.id !== videoUpload?.assetId)
        .map((p) => p.id),
    [previews, videoUpload?.assetId]
  );

  /**
   * Failed assets paired with the position number their tile shows.
   *
   * The reason is rendered here rather than inside the tile because the tiles
   * are a `minmax(96px, 1fr)` grid — roughly 110px wide in a 520px panel,
   * about fourteen characters a line. "This clip is longer than 2 minutes.
   * Trim it and upload it again." is unreadable in that column and is the
   * whole point of storing it, so the tile carries the alarm and this block
   * carries the sentence.
   */
  const failedPreviews = useMemo(
    () =>
      previews
        .map((preview, index) => ({ preview, position: index + 1 }))
        .filter(({ preview }) => preview.status === "failed"),
    [previews]
  );

  const refreshAssetStatuses = useCallback(
    async (signal: AbortSignal) => {
      if (processingAssetIds.length === 0) return;
      try {
        const res = await fetch("/api/owner/content/asset-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetIds: processingAssetIds }),
          cache: "no-store",
          signal,
        });
        if (!res.ok) {
          // Silent on screen, loud in the console. A failed poll is not worth
          // an error banner over a tile that is already saying "Processing" —
          // the next tick recovers, and the route leaves the row untouched
          // when Cloudflare is unreachable.
          console.error("[ItemFormPanel] asset status poll failed", res.status);
          return;
        }
        const json = (await res.json()) as { previews?: AssetPreview[] };
        const fresh = json.previews ?? [];

        // Only a STATUS change is worth committing. The route re-mints signed
        // URLs on every call, so taking its payload unconditionally would
        // replace the preview list — and every poster `src` on screen — once
        // every interval for no visible gain.
        const changed = fresh.filter((next) => {
          const prev = previews.find((p) => p.id === next.id);
          return prev !== undefined && prev.status !== next.status;
        });
        if (changed.length === 0) return;

        const byId = new Map(changed.map((p) => [p.id, p]));
        setPreviews((current) => current.map((p) => byId.get(p.id) ?? p));
        // Deliberately no router.refresh() here. The board behind the panel
        // renders an asset COUNT, and a processing video already counts — a
        // status transition changes nothing it displays, so refreshing the
        // server tree on every transition would buy a round trip and no pixel.
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[ItemFormPanel] asset status poll error", err);
      }
    },
    [processingAssetIds, previews]
  );

  /**
   * Visibility-aware poll of the transition route — see `useVisibilityPolling`
   * for the contract (immediate fetch on mount, pause on hidden, resume plus
   * an immediate fetch on visible, one abort controller per fetch).
   *
   * `enabled` is the stop condition the panel needs: nothing in view is
   * processing, so nothing polls. It also does the right thing on the way back
   * in — flipping it true when a new upload lands re-arms the interval AND
   * fires one immediate fetch, so the first reading is not an interval late.
   * An idle panel, and a closed one, tick zero times.
   */
  useVisibilityPolling(refreshAssetStatuses, {
    intervalMs: CONTENT_ASSET_POLL_INTERVAL_MS,
    enabled: open && processingAssetIds.length > 0,
  });

  const handlePlay = useCallback(async (assetId: string) => {
    // The player opens NOW, on the press, showing its chrome and an
    // "Opening…" box — waiting for the mint before opening would make the
    // click feel dead for a round trip.
    playbackOpenerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPlayingAssetId(assetId);
    setPlaybackUrl(null);
    setPlaybackError(null);
    setPanelCopyState("idle");
    playbackRequestRef.current = assetId;

    // Minted here rather than reused from the preview payload: preview URLs
    // are signed when the panel opens and expire an hour later, so a long
    // build session would otherwise open a player whose token died — and a
    // cross-origin iframe cannot tell us that it did. Minting at press time
    // makes the token seconds old whenever playback starts.
    const result = await createContentAssetPlaybackAction(assetId);

    // A second press on another tile while this mint was in flight wins.
    if (playbackRequestRef.current !== assetId) return;

    if (!result.ok || !result.data) {
      setPlaybackError(result.error ?? "Could not start playback");
      return;
    }
    setPlaybackUrl(result.data.iframeUrl);
  }, []);

  const handleStopPlayback = useCallback(() => {
    playbackRequestRef.current = null;
    setPlayingAssetId(null);
    setPlaybackUrl(null);
    setPlaybackError(null);
    setPanelCopyState("idle");
    // Hand focus back to the play tile so a keyboard user is not dropped on
    // <body> when the in-panel player's close button unmounts under them. On
    // the overlay path this is redundant but harmless: the overlay's own
    // restore runs after and lands on the same element. `isConnected` guards
    // a tile deleted mid-playback; an inert (closing) panel makes the call a
    // no-op, which is also right.
    const opener = playbackOpenerRef.current;
    playbackOpenerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, []);

  // Escape closes the desktop player ONLY, leaving the panel open — the
  // in-panel mirror of the overlay's capture-phase handler. SlidePanel
  // listens for Escape on window in the bubble phase, so an unstopped press
  // would close player and panel together and drop Kelsey back on the board
  // with her form gone from view. Capture phase runs first on window;
  // stopping propagation there means the panel's listener never sees the
  // press. Disarmed while the delete ConfirmDialog is up: the dialog is the
  // topmost layer and Escape belongs to it then.
  useEffect(() => {
    if (!playbackInPanel || confirmDeleteAsset !== null) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      handleStopPlayback();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [playbackInPanel, confirmDeleteAsset, handleStopPlayback]);

  // The overlay physically blocks every control that could close the panel
  // while it is up; the in-panel player does not — Done, the panel's ×, and
  // the backdrop all stay clickable during playback. SlidePanel stays
  // mounted through its slide-out animation, so without this the iframe
  // would keep playing, audio included, behind a closed panel.
  useEffect(() => {
    if (!open && playingAssetId !== null) handleStopPlayback();
  }, [open, playingAssetId, handleStopPlayback]);

  useEffect(
    () => () => {
      if (panelCopyTimerRef.current !== null)
        window.clearTimeout(panelCopyTimerRef.current);
    },
    []
  );

  /** Mirrors the overlay's copy handler; reads the LIVE caption field. */
  const handlePanelCopy = async () => {
    try {
      await navigator.clipboard.writeText(values.caption);
      setPanelCopyState("copied");
    } catch {
      setPanelCopyState("failed");
    }
    if (panelCopyTimerRef.current !== null)
      window.clearTimeout(panelCopyTimerRef.current);
    panelCopyTimerRef.current = window.setTimeout(
      () => setPanelCopyState("idle"),
      2000
    );
  };

  /**
   * A signed URL that will not load is almost always an expired one. Re-mint
   * the whole strip once and let the images retry with fresh URLs.
   */
  const handlePreviewImageError = useCallback(() => {
    if (staleUrlReloadRef.current) return;
    if (!activeItemId) return;
    staleUrlReloadRef.current = true;
    void loadPreviews(activeItemId);
  }, [activeItemId, loadPreviews]);

  /**
   * Completion is observed as a counter rather than a callback, because the
   * panel instance that started an upload is frequently not the one still
   * mounted when it finishes.
   */
  const seenCompletions = useRef(uploadSnapshot.completions);
  useEffect(() => {
    if (uploadSnapshot.completions === seenCompletions.current) return;
    seenCompletions.current = uploadSnapshot.completions;
    if (!activeItemId) return;
    void loadPreviews(activeItemId);
    router.refresh();
  }, [uploadSnapshot.completions, activeItemId, loadPreviews, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    const payload = {
      date: values.date,
      time: values.time,
      platform: values.platform,
      format: values.format,
      caption: values.caption,
    };

    const result = activeItemId
      ? await updateContentItemAction({ itemId: activeItemId, ...payload })
      : await createContentItemAction({ cycleId: cycleId ?? "", ...payload });
    setSubmitting(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not save post.");
      return;
    }

    if (!activeItemId) {
      // Stay open so photos can be added to the post that was just created.
      setActiveItemId(result.data.id);
      router.refresh();
      return;
    }
    onClose();
    router.refresh();
  };

  const handlePickPhoto = () => {
    if (!fileInputRef.current) return;
    // Reset first so re-picking the same file still fires `change`.
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  };

  const handlePhotoSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !activeItemId || uploading) return;

    setMediaError(null);
    if (file.size > MAX_PHOTO_BYTES) {
      setMediaError("Photo is larger than 25 MB.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    const urlResult = await createContentAssetUploadUrlAction({
      itemId: activeItemId,
      filename: file.name,
    });
    if (!urlResult.ok || !urlResult.data) {
      setUploading(false);
      setMediaError(urlResult.error ?? "Could not start upload");
      return;
    }

    const { signedUrl, storagePath } = urlResult.data;
    try {
      await uploadFileWithProgress(signedUrl, file, setUploadProgress);
    } catch (err) {
      setUploading(false);
      setMediaError(err instanceof Error ? err.message : "Upload failed");
      return;
    }

    // Snap to 100% so the UI flips to "Finalizing…" even when the last
    // progress tick lands below 1.0.
    setUploadProgress(1);

    const finalizeResult = await finalizeContentAssetAction({
      itemId: activeItemId,
      storagePath,
    });
    setUploading(false);

    if (!finalizeResult.ok) {
      setMediaError(finalizeResult.error ?? "Failed to save photo");
      return;
    }

    await loadPreviews(activeItemId);
    router.refresh();
  };

  const handlePickVideo = () => {
    if (!videoInputRef.current) return;
    // Reset first so re-picking the same file still fires `change` — which is
    // exactly what a resume is.
    videoInputRef.current.value = "";
    videoInputRef.current.click();
  };

  const handleContinueVideo = () => {
    setMediaError(null);
    if (!videoUpload) return;
    // After a reload the File is gone and only she can supply it again; tus
    // then HEADs the saved upload URL and sends only the missing tail.
    if (videoUpload.needsFile || !retryVideoUpload()) handlePickVideo();
  };

  const handleVideoSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !activeItemId) return;
    setMediaError(null);

    // Any pick made while an upload is paused is a RESUME, not a new upload —
    // including one reached through "Resume upload" after the in-memory File
    // was lost. The module refuses it unless the file is byte-for-byte the
    // same one: tus resumes at an offset and asks nothing about what is on
    // the other side of it, so a different file would splice two videos
    // together into something that uploads and encodes without any error.
    if (videoUpload?.phase === "paused" && videoUpload.recoverable) {
      const resumed = resumeVideoUploadWithFile(file);
      if (!resumed.ok) {
        setMediaError(resumed.error ?? "Could not continue that upload");
      }
      return;
    }

    if (file.size > MAX_VIDEO_BYTES) {
      setMediaError("Video is larger than 500 MB.");
      return;
    }

    const started = await startVideoUpload(activeItemId, file);
    if (!started.ok) {
      setMediaError(started.error ?? "Could not start upload");
      return;
    }

    // The row exists from the mint, so its tile can appear now rather than
    // only once the upload finishes.
    await loadPreviews(activeItemId);
    router.refresh();
  };

  const handleConfirmDeleteAsset = async () => {
    if (!confirmDeleteAsset || !activeItemId) return;
    setDeletingAsset(true);
    // Stop the transfer before the row goes. The delete action removes the
    // Stream video itself, so anything still pushing bytes at it is pushing
    // at something about to stop existing.
    if (videoUpload?.assetId === confirmDeleteAsset.id) {
      dismissVideoUpload();
    }
    // Close the player if it is the one being removed — its token is about to
    // point at a video that no longer exists.
    if (playingAssetId === confirmDeleteAsset.id) handleStopPlayback();
    const result = await deleteContentAssetAction(confirmDeleteAsset.id);
    setDeletingAsset(false);
    if (!result.ok) {
      setMediaError(result.error ?? "Could not delete photo");
      setConfirmDeleteAsset(null);
      return;
    }
    setConfirmDeleteAsset(null);
    await loadPreviews(activeItemId);
    router.refresh();
  };

  const isCarousel = values.format === "carousel";

  // From LIVE form values, not the saved row, so the overlay always says what
  // the form says — including edits not saved yet. The date/time guards cover
  // a field mid-edit (a cleared `<input type="date">` reports "").
  const overlayMeta = [
    values.date ? fullDateLabelForDateKey(values.date) : null,
    values.time ? timeLabelFromInputValue(values.time) : null,
    `${PLATFORM_LABELS[values.platform]} ${FORMAT_LABELS[values.format]}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const playbackClientName = item?.client_name || clientName;
  const hasPanelCaption = values.caption.trim() !== "";

  return (
    <>
      <SlidePanel
        open={open}
        onClose={onClose}
        title={activeItemId ? "Edit post" : "New post"}
        widthPx={playbackInPanel ? PANEL_WIDTH_PLAYING_PX : PANEL_WIDTH_PX}
      >
        {/* Row that seats the desktop player beside the form. The player
            column is ALWAYS in the tree, at width 0 while closed, rather than
            mounted on demand: its width and the panel's animate in step, so
            the form column's width interpolates smoothly instead of snapping
            — and the children array never changes shape, so opening playback
            never remounts the form (focus, scroll position, and field DOM
            survive; the values would either way, they live in this
            component). minHeight 100% is what h-full used to do for the
            form: full height when content is short so the footer stays at
            the bottom, free to grow when the form is taller. */}
        <div className="flex" style={{ minHeight: "100%" }}>
          <div
            style={{
              ...playerColStyle,
              width: playbackInPanel ? PLAYER_COL_WIDTH_CSS : 0,
            }}
          >
            {playbackInPanel && (
              <div style={playerStickyStyle}>
                <div style={playerChromeRowStyle}>
                  <span style={playerLabelStyle}>Video</span>
                  <button
                    type="button"
                    onClick={handleStopPlayback}
                    aria-label="Close video"
                    style={playerCloseStyle}
                  >
                    ×
                  </button>
                </div>
                {playbackError ? (
                  /* Mint failure shown where the video would be, same as the
                     overlay: she is already looking here when it lands. */
                  <div role="alert" style={playerNoteStyle}>
                    {playbackError}
                  </div>
                ) : playbackUrl ? (
                  /* Autoplay and the mauve primaryColor ride on the minted
                     src itself (see createPlaybackUrls); allow="autoplay"
                     delegates the press so unmuted autoplay is honoured. */
                  <iframe
                    src={playbackUrl}
                    title={
                      playbackClientName
                        ? `${playbackClientName} video`
                        : "Video"
                    }
                    style={playerIframeStyle}
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                    allowFullScreen
                  />
                ) : (
                  <div role="status" style={playerNoteStyle}>
                    Opening…
                  </div>
                )}
                <button
                  type="button"
                  onClick={handlePanelCopy}
                  disabled={!hasPanelCaption}
                  style={{
                    ...playerCopyStyle,
                    opacity: hasPanelCaption ? 1 : 0.5,
                    cursor: hasPanelCaption ? "pointer" : "default",
                  }}
                >
                  {panelCopyState === "copied"
                    ? "Copied"
                    : panelCopyState === "failed"
                      ? "Couldn't copy"
                      : "Copy caption"}
                </button>
              </div>
            )}
          </div>
          <form
            onSubmit={handleSubmit}
            className="flex flex-col"
            style={formColStyle}
          >
          <div className="flex-1 space-y-5">
            {/* What the client asked for — read-only, above the form so it is
                the first thing Kelsey reads when she opens a submitted item.
                Fetches its own data on open (live even when the board's item
                snapshot is stale); renders nothing when no request exists. */}
            {activeItemId && (
              <RevisionRequestSection
                itemId={activeItemId}
                open={open}
                expectRequest={item?.status === "changes_requested"}
                onResolved={() => {
                  // An accept may have swapped the item's live media — the
                  // preview strip's old poster is now a deleted video's.
                  if (activeItemId) void loadPreviews(activeItemId);
                  router.refresh();
                }}
              />
            )}
            {/* Row and helper share one space-y child so the helper sits in
                normal flow under the inputs. (Its old `marginTop: -12` was
                written against v4 space-y semantics; under v3, space-y puts
                margin-TOP on following siblings, so the inline value replaced
                +20px outright and the text rode up over the time field.) */}
            <div>
              <div className="flex gap-4">
                <div style={{ flex: 1 }}>
                  <label htmlFor="item-date" style={labelStyle}>
                    Date
                  </label>
                  <input
                    id="item-date"
                    type="date"
                    required
                    value={values.date}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, date: e.target.value }))
                    }
                    onFocus={applyFocus}
                    onBlur={clearFocus}
                    style={fieldStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="item-time" style={labelStyle}>
                    Time
                  </label>
                  <input
                    id="item-time"
                    type="time"
                    required
                    value={values.time}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, time: e.target.value }))
                    }
                    onFocus={applyFocus}
                    onBlur={clearFocus}
                    style={fieldStyle}
                  />
                </div>
              </div>
              <p style={helperStyle}>
                Central time. Must fall inside the cycle&apos;s month.
              </p>
            </div>

            <div className="flex gap-4">
              <div style={{ flex: 1 }}>
                <label htmlFor="item-platform" style={labelStyle}>
                  Platform
                </label>
                <select
                  id="item-platform"
                  value={values.platform}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      platform: e.target.value as Platform,
                    }))
                  }
                  onFocus={applyFocus}
                  onBlur={clearFocus}
                  style={fieldStyle}
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="item-format" style={labelStyle}>
                  Format
                </label>
                <select
                  id="item-format"
                  value={values.format}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      format: e.target.value as PostFormat,
                    }))
                  }
                  onFocus={applyFocus}
                  onBlur={clearFocus}
                  style={fieldStyle}
                >
                  {FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="item-caption" style={labelStyle}>
                Caption
              </label>
              <textarea
                id="item-caption"
                rows={5}
                value={values.caption}
                onChange={(e) =>
                  setValues((v) => ({ ...v, caption: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={{ ...fieldStyle, minHeight: 120, resize: "vertical" }}
              />
            </div>

            {error && (
              <div role="alert" style={errorStyle}>
                {error}
              </div>
            )}

            <div style={mediaSectionStyle}>
              <span style={labelStyle}>Media</span>
              {!activeItemId ? (
                /* Same dashed frame the add tiles use, so the section reads
                   as "media goes here" before it can hold any. */
                <div style={mediaEmptyHintStyle}>
                  Save the post first — media attaches to it once it exists.
                </div>
              ) : (
                <>
                  <p style={helperStyle}>
                    {isCarousel
                      ? "Carousel: media plays in the order shown below."
                      : "Photos and video attach here in the order shown below."}
                  </p>

                  {previewsLoading && previews.length === 0 && (
                    <p style={mutedNoteStyle}>Loading media…</p>
                  )}

                  {/* One grid holds the media AND the two add tiles, so the
                      way in lives where the result lands — and an empty post
                      shows two inviting tiles instead of a bare button row. */}
                  <div style={thumbGridStyle}>
                    {previews.map((preview, index) => (
                      <figure key={preview.id} style={thumbFigureStyle}>
                        {preview.url && preview.status === "ready" &&
                          preview.kind === "video" ? (
                          /* Ready video: the signed poster frame, pressable.
                             A button rather than a click handler on the image
                             so it is reachable by keyboard and announces
                             itself. Pressing opens playback — beside the form
                             in the widened panel on desktop, the full-screen
                             overlay on mobile. The player never renders in
                             this ~110px column, where it was unwatchable. */
                          <button
                            type="button"
                            onClick={() => void handlePlay(preview.id)}
                            style={thumbPlayButtonStyle}
                            aria-label={`Play video ${index + 1}`}
                          >
                            <img
                              src={preview.url}
                              alt=""
                              style={thumbImgStyle}
                              onError={handlePreviewImageError}
                            />
                            <span aria-hidden="true" style={playOverlayStyle}>
                              ▶
                            </span>
                          </button>
                        ) : preview.url ? (
                          /* Plain <img>: these are short-lived signed URLs
                             against a private bucket, so the Image optimizer
                             has no stable host to whitelist. */
                          <img
                            src={preview.url}
                            alt={`Photo ${index + 1}`}
                            style={thumbImgStyle}
                            onError={handlePreviewImageError}
                          />
                        ) : (
                          /* Nothing to show as an image: a video that is
                             still processing or has failed has no frame to
                             ask Cloudflare for, and a photo whose object went
                             missing has none at all. The tile is still
                             rendered either way. Omitting it would make an
                             uploaded video invisible while its row holds a
                             carousel slot, which reads as a lost upload and
                             invites a second one into a position already
                             taken. */
                          <div
                            role="img"
                            aria-label={`${tileLabel(preview, videoUpload)}, position ${index + 1}`}
                            style={
                              preview.status === "failed"
                                ? thumbFailedPlaceholderStyle
                                : thumbPlaceholderStyle
                            }
                          >
                            <span aria-hidden="true" style={placeholderMarkStyle}>
                              {preview.status === "failed"
                                ? "!"
                                : preview.kind === "video"
                                  ? "▶"
                                  : "!"}
                            </span>
                            <span style={placeholderTextStyle}>
                              {tileLabel(preview, videoUpload)}
                            </span>
                          </div>
                        )}
                        <span aria-hidden="true" style={orderBadgeStyle}>
                          {index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAsset(preview)}
                          aria-label={`Remove ${
                            preview.kind === "video" ? "video" : "photo"
                          } ${index + 1}`}
                          style={removeChipStyle}
                        >
                          ×
                        </button>
                      </figure>
                    ))}

                    {/* The photo tile doubles as the progress readout while
                        its upload runs — the one moment it can't be pressed
                        anyway. */}
                    <button
                      type="button"
                      onClick={handlePickPhoto}
                      disabled={uploading}
                      style={{
                        ...addTileStyle,
                        cursor: uploading ? "default" : "pointer",
                      }}
                    >
                      {uploading ? (
                        <>
                          <span style={addTileMarkStyle}>
                            {Math.round(uploadProgress * 100)}%
                          </span>
                          <span style={addTileLabelStyle}>
                            {uploadProgress >= 1 ? "Finalizing" : "Uploading"}
                          </span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true" style={addTileMarkStyle}>
                            +
                          </span>
                          <span style={addTileLabelStyle}>Photo</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handlePickVideo}
                      disabled={addVideoDisabled}
                      style={{
                        ...addTileStyle,
                        opacity: addVideoDisabled ? 0.5 : 1,
                        cursor: addVideoDisabled ? "not-allowed" : "pointer",
                      }}
                    >
                      <span aria-hidden="true" style={addTileMarkStyle}>
                        +
                      </span>
                      <span style={addTileLabelStyle}>Video</span>
                    </button>
                  </div>

                  {failedPreviews.length > 0 && (
                    <div role="alert" style={assetFailureStyle}>
                      {failedPreviews.map(({ preview, position }) => (
                        <p key={preview.id} style={assetFailureLineStyle}>
                          <strong>#{position}</strong>{" "}
                          {preview.errorReason ??
                            "Cloudflare couldn't encode this video. Remove it and upload the clip again."}
                        </p>
                      ))}
                    </div>
                  )}

                  {videoUpload && (
                    <div style={videoUploadBoxStyle}>
                      <div style={videoStatusStyle}>
                        {videoUpload.phase === "paused" ? (
                          <>
                            <span style={videoStatusTextStyle}>
                              {videoUpload.needsFile
                                ? videoUpload.filename
                                : `${videoUpload.filename} — paused at ${Math.round(
                                    videoUpload.progress * 100
                                  )}%`}
                            </span>
                            {videoUpload.recoverable ? (
                              <button
                                type="button"
                                onClick={handleContinueVideo}
                                style={addMediaStyle}
                              >
                                {videoUpload.needsFile
                                  ? "Pick the file to continue"
                                  : "Resume upload"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={dismissVideoUpload}
                                style={addMediaStyle}
                              >
                                Dismiss
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <UploadProgressIndicator
                              fraction={videoUpload.progress}
                            />
                            <span style={videoStatusTextStyle}>
                              {videoUpload.filename}
                            </span>
                          </>
                        )}
                      </div>
                      {/* Says exactly what the platform does and nothing
                          more. There is no background upload API in Safari:
                          a closed tab, a reload, or a backgrounded app on
                          iPhone stops the transfer. What survives is the
                          byte offset. Lives inside the upload box — while a
                          transfer is running is the only time the warning
                          can change what she does next. */}
                      <p style={videoUploadNoteStyle}>
                        Video uploads pick up where they stopped. They only
                        move while this screen is open — closing the tab,
                        reloading, or switching apps on a phone pauses the
                        upload until you come back to it.
                      </p>
                    </div>
                  )}

                  {/* Otherwise "Add video" is disabled with no reason on
                      screen — the upload she is waiting on is on a different
                      post, so nothing above accounts for it. A replacement
                      upload on THIS post is excluded: its progress is already
                      on screen in the change-request block above, and "another
                      post" would be wrong. */}
                  {!videoUpload &&
                    uploadSnapshot.active &&
                    uploadSnapshot.active.itemId !== activeItemId && (
                      <p style={mutedNoteStyle}>
                        A video is uploading on another post. Videos upload one
                        at a time.
                      </p>
                    )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoSelected}
                    style={{ display: "none" }}
                  />
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    onChange={handleVideoSelected}
                    style={{ display: "none" }}
                  />

                  {(mediaError || videoUpload?.error) && (
                    <div role="alert" style={errorStyle}>
                      {mediaError ?? videoUpload?.error}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div style={footerStyle}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={cancelStyle}
            >
              {activeItemId ? "Done" : "Cancel"}
            </button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? "Saving…"
                : activeItemId
                  ? "Save changes"
                  : "Create post"}
            </Button>
          </div>
          </form>
        </div>
      </SlidePanel>

      {/* Mobile only — at 900px and up the player is seated inside the
          widened panel instead, where blacking out the screen for a short
          clip read as a jump cut. A sibling of SlidePanel, never a second
          SlidePanel: the panel's body scroll-lock is not re-entrant (its
          lines 56–58), and the overlay relies on the panel underneath
          staying open — form state, unsaved caption included, is exactly as
          she left it when this closes. Mounting only while playing is what
          stops the audio on close, on both surfaces. */}
      {playingAssetId !== null && !isDesktopViewport && (
        <VideoPlaybackOverlay
          onClose={handleStopPlayback}
          iframeUrl={playbackUrl}
          error={playbackError}
          clientName={playbackClientName}
          meta={overlayMeta}
          caption={values.caption}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteAsset !== null}
        onCancel={() => {
          if (deletingAsset) return;
          setConfirmDeleteAsset(null);
        }}
        onConfirm={handleConfirmDeleteAsset}
        title={
          confirmDeleteAsset?.kind === "video"
            ? "Remove video?"
            : "Remove photo?"
        }
        body={
          confirmDeleteAsset?.kind === "video"
            ? "The video is deleted from Cloudflare Stream — including one that is still uploading or still processing. This can't be undone."
            : "The photo is deleted from storage. This can't be undone."
        }
        confirmLabel="Remove"
        variant="danger"
        busy={deletingAsset}
      />
    </>
  );
}

const mediaSectionStyle: CSSProperties = {
  paddingTop: 20,
  borderTop: "1px solid var(--border)",
};

const thumbGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
  gap: 10,
  margin: "12px 0",
};

// `relative` anchors the order badge and remove chip to the tile's corners.
const thumbFigureStyle: CSSProperties = {
  margin: 0,
  position: "relative",
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
};

// 9:16 vertical throughout, never cropped to square (spec §3.9).
const thumbImgStyle: CSSProperties = {
  display: "block",
  width: "100%",
  aspectRatio: "9 / 16",
  objectFit: "cover",
};

/**
 * Corner chips over the tile image. The same dark scrim as playOverlayStyle,
 * for the same reason — they sit on photographs, so they carry their own
 * contrast instead of borrowing the tile's.
 */
const orderBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  left: 6,
  minWidth: 20,
  height: 20,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 5px",
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1,
  color: "#fff",
  backgroundColor: "rgba(0,0,0,0.55)",
};

// Painted after the play button in DOM order, so it wins the corner it
// covers — a press on the chip never starts playback.
const removeChipStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  width: 24,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  padding: 0,
  fontSize: 15,
  lineHeight: 1,
  color: "#fff",
  backgroundColor: "rgba(0,0,0,0.55)",
  cursor: "pointer",
};

const mutedNoteStyle: CSSProperties = {
  margin: "8px 0",
  fontSize: 12,
  color: "var(--text-muted)",
};

// Resume/dismiss actions inside the video-upload box.
const addMediaStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  minHeight: 44,
  padding: "0 16px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--accent)",
  cursor: "pointer",
};

/**
 * The add-photo / add-video tiles. Same cell and 9:16 ratio as the media
 * tiles they sit among; dashed where real media is solid, so they read as
 * "goes here" rather than content.
 */
const addTileStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  aspectRatio: "9 / 16",
  padding: 6,
  border: "1px dashed var(--border)",
  background: "transparent",
  color: "var(--accent)",
};

const addTileMarkStyle: CSSProperties = {
  fontSize: 20,
  lineHeight: 1,
  fontWeight: 500,
};

const addTileLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

// Dashed like the add tiles it stands in for, before a post exists to
// attach media to.
const mediaEmptyHintStyle: CSSProperties = {
  margin: "12px 0 4px",
  padding: "20px 16px",
  border: "1px dashed var(--border)",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--text-muted)",
  textAlign: "center",
};

const videoUploadBoxStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  margin: "8px 0",
  padding: "10px 12px",
  border: "1px solid var(--border)",
  background: "#FFFFFF",
};

const videoUploadNoteStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--text-muted)",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 12,
  marginTop: 24,
  paddingTop: 16,
  borderTop: "1px solid var(--border)",
};

const thumbPlaceholderStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  // Matches thumbImgStyle exactly so a video tile and a photo tile are the
  // same size in the grid (9:16 vertical throughout, spec §3.9).
  aspectRatio: "9 / 16",
  backgroundColor: "var(--surface-sunken, var(--surface-raised))",
  color: "var(--text-muted)",
  textAlign: "center",
  padding: 6,
};

// A failed tile has to be findable at a glance in a strip of otherwise
// healthy ones — the sentence explaining it lives below the grid, and this is
// what points at which tile the sentence is about.
const thumbFailedPlaceholderStyle: CSSProperties = {
  ...thumbPlaceholderStyle,
  color: "var(--status-danger)",
  borderBottom: "2px solid var(--status-danger)",
};

const thumbPlayButtonStyle: CSSProperties = {
  display: "block",
  position: "relative",
  width: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

const playOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 24,
  lineHeight: 1,
  color: "#fff",
  // The poster is a photograph, so the glyph needs its own contrast rather
  // than borrowing the tile's — a light frame would otherwise swallow it.
  textShadow: "0 1px 6px rgba(0,0,0,0.75)",
  backgroundColor: "rgba(0,0,0,0.12)",
};

const assetFailureStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  margin: "8px 0",
  padding: "10px 12px",
  border: "1px solid var(--status-danger)",
  color: "var(--status-danger)",
};

const assetFailureLineStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
};

const placeholderMarkStyle: CSSProperties = {
  fontSize: 18,
  lineHeight: 1,
  opacity: 0.7,
};

const placeholderTextStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const videoStatusStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
};

const videoStatusTextStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};

const cancelStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  minHeight: 44,
  padding: "0 8px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-body)",
  cursor: "pointer",
};

/**
 * The clipping column the desktop player lives in. `overflowX: clip`, never
 * `hidden`: a hidden ancestor becomes a scroll container, which would make
 * the sticky inner pin to the column itself (which never scrolls) instead of
 * the panel's scroll area. Its width transition matches SlidePanel's so the
 * reveal and the widen move as one.
 */
const playerColStyle: CSSProperties = {
  flex: "0 0 auto",
  overflowX: "clip",
  transition: "width 200ms ease-out",
};

/** Sticks while a long form scrolls beside it. `top` matches the scroll
 * container's 20px padding so pinning doesn't shift the player. The gutter
 * rides here as padding so it collapses with the column. */
const playerStickyStyle: CSSProperties = {
  position: "sticky",
  top: 20,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  paddingRight: PLAYER_GUTTER_PX,
};

const playerChromeRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const playerLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

// Matches SlidePanel's own header close button, so the player column reads
// as part of the panel rather than a layer floating over it.
const playerCloseStyle: CSSProperties = {
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-body)",
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  flex: "0 0 auto",
};

/** ~360x640 (width follows from the ratio). --sidebar-deep behind the
 * player while it boots — the overlay's video-box idiom, and the same green
 * the minted URL's letterboxColor pads non-9:16 clips with, so the box
 * reads intentional in every state. */
const playerVideoBoxStyle: CSSProperties = {
  height: PLAYER_HEIGHT_CSS,
  aspectRatio: "9 / 16",
  backgroundColor: "var(--sidebar-deep)",
};

const playerIframeStyle: CSSProperties = {
  ...playerVideoBoxStyle,
  display: "block",
  border: "none",
};

// Cream on the deep green, like the overlay's "Opening…" and error notes.
const playerNoteStyle: CSSProperties = {
  ...playerVideoBoxStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  textAlign: "center",
  fontSize: 13,
  lineHeight: 1.5,
  color: "rgba(242, 237, 228, 0.8)",
};

const playerCopyStyle: CSSProperties = {
  alignSelf: "flex-start",
  background: "transparent",
  border: "1px solid var(--border)",
  minHeight: 36,
  padding: "0 14px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--accent)",
};

/** Flexes into whatever the player column leaves; full width while it is
 * collapsed, so the closed-player layout is pixel-identical to before. */
const formColStyle: CSSProperties = {
  flex: "1 1 0%",
  minWidth: 0,
};
