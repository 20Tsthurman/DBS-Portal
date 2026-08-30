import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";

import {
  createDirectUploadUrl,
  createPlaybackToken,
  createPlaybackUrls,
  createResumableUploadUrl,
  deleteVideo,
  describeStreamError,
  getVideoStatus,
} from "./stream";

/**
 * Targeted tests for lib/stream.ts — the only tested module in the repo, per
 * the build plan's risk register: Stream is the single place a vendor contract
 * can break silently and surface as a dead player in front of a client.
 * Everything else in the portal fails loudly.
 *
 * The HTTP layer is mocked throughout. Nothing here touches Cloudflare.
 *
 * What these tests are actually guarding, in order of how expensive the
 * regression would be:
 *   - `requireSignedURLs: true` and `maxDurationSeconds: 120` on every mint.
 *     Losing the first makes every client's video public to anyone with the
 *     URL (spec §3.5a); losing the second lets abandoned uploads eat the
 *     prepaid storage block (§3.5d).
 *   - Readiness requiring the FULL encode ladder, not the first rendition.
 *   - A signed token that decodes to the right video with a future expiry.
 *   - Cloudflare's two-stage failure mode (a 200 can still be a failure).
 */

const ACCOUNT_ID = "023e105f4ecef8ad9ca31a8372d0c353";
const API_TOKEN = "test-stream-edit-token";
const SIGNING_KEY_ID = "8f926b2b01f383510025a78a4dcbf6a";
const VIDEO_UID = "ea95132c15732412d22c1476fa83f27a";
const CUSTOMER_SUBDOMAIN = "customer-f33zs165nr7gyfy4.cloudflarestream.com";

const STREAM_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream`;

// A throwaway RSA keypair standing in for the Cloudflare signing key. Generated
// once for the whole file — 2048-bit keygen is not free.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Cloudflare hands back the PEM base64-encoded, and that is the form the env
// var holds. Encoding it here means the test exercises the same decode the
// real value goes through.
const SIGNING_KEY_PEM_BASE64 = Buffer.from(privateKey).toString("base64");

/** Minimal stand-in for a fetch Response; lib/stream.ts reads only these. */
function response(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function jsonResponse(status: number, body: unknown) {
  return response(status, JSON.stringify(body));
}

/** The success envelope every Cloudflare v4 endpoint wraps its payload in. */
function ok(result: unknown) {
  return jsonResponse(200, {
    result,
    success: true,
    errors: [],
    messages: [],
  });
}

let fetchMock = vi.fn();

/** The (url, init) pair passed to fetch on call `n`. */
function callArgs(n = 0): [string, RequestInit] {
  return fetchMock.mock.calls[n] as [string, RequestInit];
}

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT_ID);
  vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", API_TOKEN);
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", SIGNING_KEY_ID);
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", SIGNING_KEY_PEM_BASE64);
  vi.stubEnv("CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN", CUSTOMER_SUBDOMAIN);

  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("createDirectUploadUrl", () => {
  it("POSTs to /direct_upload with the account id and bearer token", async () => {
    fetchMock.mockResolvedValue(
      ok({ uploadURL: "https://upload.videodelivery.net/abc", uid: "abc" })
    );

    await createDirectUploadUrl();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = callArgs();
    expect(url).toBe(`${STREAM_BASE}/direct_upload`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    });
    expect(init.cache).toBe("no-store");
  });

  it("sends exactly requireSignedURLs:true and maxDurationSeconds:120", async () => {
    fetchMock.mockResolvedValue(
      ok({ uploadURL: "https://upload.videodelivery.net/abc", uid: "abc" })
    );

    await createDirectUploadUrl();

    // toEqual, not toMatchObject: an extra or renamed body field is a contract
    // change and should fail here rather than in front of a client.
    const [, init] = callArgs();
    expect(JSON.parse(String(init.body))).toEqual({
      maxDurationSeconds: 120,
      requireSignedURLs: true,
    });
  });

  it("returns the upload URL and the Stream video uid", async () => {
    fetchMock.mockResolvedValue(
      ok({
        uploadURL: "https://upload.videodelivery.net/f65014bc6ff5419ea86e",
        uid: "f65014bc6ff5419ea86e",
      })
    );

    await expect(createDirectUploadUrl()).resolves.toEqual({
      uploadUrl: "https://upload.videodelivery.net/f65014bc6ff5419ea86e",
      uid: "f65014bc6ff5419ea86e",
    });
  });

  it("throws on a non-2xx response, surfacing Cloudflare's error codes", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        result: null,
        success: false,
        errors: [{ code: 10000, message: "Authentication error" }],
        messages: [],
      })
    );

    await expect(createDirectUploadUrl()).rejects.toThrow(
      /HTTP 401.*10000.*Authentication error/
    );
  });

  it("throws on a 200 that carries success:false", async () => {
    // Cloudflare's two-stage failure mode: res.ok is not sufficient.
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        result: null,
        success: false,
        errors: [{ code: 10005, message: "Bad request" }],
        messages: [],
      })
    );

    await expect(createDirectUploadUrl()).rejects.toThrow(
      /reported failure.*10005.*Bad request/
    );
  });

  it("throws when the result omits uploadURL or uid", async () => {
    fetchMock.mockResolvedValue(ok({ uid: "abc" }));

    await expect(createDirectUploadUrl()).rejects.toThrow(
      /no uploadURL or uid/
    );
  });

  it("throws before calling Cloudflare when the account id is unset", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");

    await expect(createDirectUploadUrl()).rejects.toThrow(
      /CLOUDFLARE_ACCOUNT_ID/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createResumableUploadUrl", () => {
  /**
   * A tus creation response. Unlike every other Stream endpoint, the payload
   * is entirely in HEADERS and the body is empty, so this stand-in needs a
   * case-insensitive `headers.get` the way a real `Response` has.
   */
  function tusResponse(
    status: number,
    headers: Record<string, string>,
    body = ""
  ) {
    const lower = new Map(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    };
  }

  const TUS_URL = `https://upload.videodelivery.net/tus/${VIDEO_UID}?tusv2=true`;

  function created(overrides: Record<string, string> = {}) {
    return tusResponse(201, {
      Location: TUS_URL,
      "stream-media-id": VIDEO_UID,
      ...overrides,
    });
  }

  it("POSTs to /stream?direct_user=true with the tus creation headers", async () => {
    fetchMock.mockResolvedValue(created());

    await createResumableUploadUrl(52_428_800);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = callArgs();
    expect(url).toBe(`${STREAM_BASE}?direct_user=true`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_TOKEN}`,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": "52428800",
    });
    // No JSON body: a tus creation's parameters are all headers. Sending one
    // would be silently ignored, which is how a cap or a flag goes missing.
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe("no-store");
  });

  it("sends maxDurationSeconds and the valueless requiresignedurls key", async () => {
    fetchMock.mockResolvedValue(created());

    await createResumableUploadUrl(1024);

    // The exact string, not a loose match. `MTIw` is base64 of "120", and
    // `requiresignedurls` carries NO value — that is the tus spelling of
    // requireSignedURLs:true. Cloudflare ignores an unrecognized metadata key
    // rather than rejecting it, so a typo here ships a publicly-readable
    // video (spec §3.5a) with nothing reporting a problem. This assertion is
    // the only thing standing between that and production.
    const [, init] = callArgs();
    const headers = init.headers as Record<string, string>;
    expect(headers["Upload-Metadata"]).toBe(
      "maxDurationSeconds MTIw,requiresignedurls"
    );
    expect(Buffer.from("MTIw", "base64").toString("utf8")).toBe("120");
  });

  it("reads the upload URL from Location and the uid from stream-media-id", async () => {
    fetchMock.mockResolvedValue(created());

    await expect(createResumableUploadUrl(1024)).resolves.toEqual({
      uploadUrl: TUS_URL,
      uid: VIDEO_UID,
    });
  });

  it("matches the uid against any path segment, not a fixed position", async () => {
    // Guards against pinning Cloudflare's URL shape: a vendor reshuffle that
    // appends a segment must not read as a uid mismatch and take uploads down.
    fetchMock.mockResolvedValue(
      created({
        Location: `https://upload.videodelivery.net/tus/${VIDEO_UID}/resume`,
      })
    );

    await expect(createResumableUploadUrl(1024)).resolves.toMatchObject({
      uid: VIDEO_UID,
    });
  });

  it("throws when the upload URL names a different video", async () => {
    // external_id is the ONLY pointer from Postgres back to the video (spec
    // §3.5c). Persisting a uid the bytes did not land under yields a row that
    // can never play and a video that can never be deleted.
    fetchMock.mockResolvedValue(
      created({
        Location: "https://upload.videodelivery.net/tus/some-other-video",
      })
    );

    await expect(createResumableUploadUrl(1024)).rejects.toThrow(
      /does not carry uid .*refusing to persist/
    );
  });

  it("throws when Cloudflare returns no Location header", async () => {
    fetchMock.mockResolvedValue(
      tusResponse(201, { "stream-media-id": VIDEO_UID })
    );

    await expect(createResumableUploadUrl(1024)).rejects.toThrow(
      /no Location header/
    );
  });

  it("throws when Cloudflare returns no stream-media-id header", async () => {
    fetchMock.mockResolvedValue(tusResponse(201, { Location: TUS_URL }));

    await expect(createResumableUploadUrl(1024)).rejects.toThrow(
      /no stream-media-id header/
    );
  });

  it("throws on a non-2xx, surfacing Cloudflare's error codes from the body", async () => {
    // A tus creation has no success envelope to check, but a FAILURE still
    // carries the normal v4 error array — the only useful diagnostic when the
    // token is wrong or the account is out of storage.
    fetchMock.mockResolvedValue(
      tusResponse(
        403,
        {},
        JSON.stringify({
          result: null,
          success: false,
          errors: [{ code: 10004, message: "Out of storage" }],
          messages: [],
        })
      )
    );

    await expect(createResumableUploadUrl(1024)).rejects.toThrow(
      /HTTP 403.*10004.*Out of storage/
    );
  });

  it("rejects a size that cannot be an Upload-Length, without calling Cloudflare", async () => {
    await expect(createResumableUploadUrl(0)).rejects.toThrow(
      /positive integer Upload-Length/
    );
    await expect(createResumableUploadUrl(-1)).rejects.toThrow(
      /positive integer Upload-Length/
    );
    await expect(createResumableUploadUrl(1.5)).rejects.toThrow(
      /positive integer Upload-Length/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws before calling Cloudflare when the api token is unset", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", "");

    await expect(createResumableUploadUrl(1024)).rejects.toThrow(
      /CLOUDFLARE_STREAM_TOKEN/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getVideoStatus", () => {
  /** A ready video, shaped like Cloudflare's documented payload. */
  function readyVideo(overrides: Record<string, unknown> = {}) {
    return {
      uid: VIDEO_UID,
      readyToStream: true,
      duration: 5.5,
      size: 383631,
      input: { width: 1080, height: 1920 },
      status: {
        state: "ready",
        pctComplete: "100.000000",
        errorReasonCode: "",
        errorReasonText: "",
      },
      ...overrides,
    };
  }

  it("GETs the video by uid with no request body", async () => {
    fetchMock.mockResolvedValue(ok(readyVideo()));

    await getVideoStatus(VIDEO_UID);

    const [url, init] = callArgs();
    expect(url).toBe(`${STREAM_BASE}/${VIDEO_UID}`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("maps a fully encoded video to ready with the metadata content_assets needs", async () => {
    fetchMock.mockResolvedValue(ok(readyVideo()));

    await expect(getVideoStatus(VIDEO_UID)).resolves.toEqual({
      uid: VIDEO_UID,
      status: "ready",
      vendorState: "ready",
      errorReason: null,
      errorCode: null,
      durationSeconds: 5.5,
      width: 1080,
      height: 1920,
      sizeBytes: 383631,
    });
  });

  it("stays processing when readyToStream flipped but the ladder is unfinished", async () => {
    // The regression that matters most here: Cloudflare sets readyToStream as
    // soon as the FIRST rendition encodes. Releasing on that alone hands a
    // client on a weak connection the exact experience Stream was adopted to
    // avoid (spec §3.2).
    fetchMock.mockResolvedValue(
      ok(
        readyVideo({
          readyToStream: true,
          status: { state: "inprogress", pctComplete: "39.000000" },
        })
      )
    );

    const result = await getVideoStatus(VIDEO_UID);
    expect(result.status).toBe("processing");
    expect(result.vendorState).toBe("inprogress");
  });

  it("stays processing for a minted uid whose upload never arrived", async () => {
    fetchMock.mockResolvedValue(
      ok({
        uid: VIDEO_UID,
        readyToStream: false,
        status: { state: "pendingupload" },
      })
    );

    await expect(getVideoStatus(VIDEO_UID)).resolves.toMatchObject({
      status: "processing",
      vendorState: "pendingupload",
    });
  });

  it("maps an encoding error to failed and carries the reason", async () => {
    fetchMock.mockResolvedValue(
      ok({
        uid: VIDEO_UID,
        readyToStream: false,
        status: {
          state: "error",
          errorReasonCode: "ERR_DURATION_EXCEED_CONSTRAINT",
          errorReasonText: "The video is longer than the allowed duration.",
        },
      })
    );

    await expect(getVideoStatus(VIDEO_UID)).resolves.toMatchObject({
      status: "failed",
      errorReason: "The video is longer than the allowed duration.",
      // The CODE is carried separately from the TEXT because it is the
      // matchable half — describeStreamError keys off it.
      errorCode: "ERR_DURATION_EXCEED_CONSTRAINT",
    });
  });

  it("reads the errReason* spelling Cloudflare's docs also use", async () => {
    fetchMock.mockResolvedValue(
      ok({
        uid: VIDEO_UID,
        readyToStream: false,
        status: {
          state: "error",
          errReasonCode: "ERR_MALFORMED_VIDEO",
          errReasonText: "The video was deemed to be corrupted or malformed.",
        },
      })
    );

    await expect(getVideoStatus(VIDEO_UID)).resolves.toMatchObject({
      status: "failed",
      errorReason: "The video was deemed to be corrupted or malformed.",
      errorCode: "ERR_MALFORMED_VIDEO",
    });
  });

  it("falls through an empty reason text to the reason code", async () => {
    // Cloudflare sends errorReasonText:"" rather than omitting the key, so a
    // plain ?? chain would stop there and report a failure with no reason.
    fetchMock.mockResolvedValue(
      ok({
        uid: VIDEO_UID,
        readyToStream: false,
        status: {
          state: "error",
          errorReasonCode: "ERR_NON_VIDEO",
          errorReasonText: "",
        },
      })
    );

    await expect(getVideoStatus(VIDEO_UID)).resolves.toMatchObject({
      status: "failed",
      errorReason: "ERR_NON_VIDEO",
    });
  });

  it("normalizes Cloudflare's -1 not-yet-known sentinels to null", async () => {
    // -1 written into content_assets would render as a real dimension.
    fetchMock.mockResolvedValue(
      ok({
        uid: VIDEO_UID,
        readyToStream: false,
        duration: -1,
        input: { width: -1, height: -1 },
        status: { state: "queued" },
      })
    );

    await expect(getVideoStatus(VIDEO_UID)).resolves.toMatchObject({
      status: "processing",
      durationSeconds: null,
      width: null,
      height: null,
      sizeBytes: null,
    });
  });

  it("throws when the video does not exist", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, {
        result: null,
        success: false,
        errors: [{ code: 10006, message: "Resource not found" }],
        messages: [],
      })
    );

    await expect(getVideoStatus(VIDEO_UID)).rejects.toThrow(
      /HTTP 404.*Resource not found/
    );
  });
});

describe("createPlaybackToken", () => {
  function decodeSegment(segment: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  }

  it("mints a token whose payload names the video uid and a future expiry", () => {
    const before = Math.floor(Date.now() / 1000);
    const { token, expiresAt } = createPlaybackToken(VIDEO_UID);
    const after = Math.floor(Date.now() / 1000);

    const [rawHeader, rawPayload, signature] = token.split(".");
    expect(signature).toBeTruthy();

    expect(decodeSegment(rawHeader)).toEqual({
      alg: "RS256",
      kid: SIGNING_KEY_ID,
    });

    const payload = decodeSegment(rawPayload);
    expect(payload.sub).toBe(VIDEO_UID);
    expect(payload.kid).toBe(SIGNING_KEY_ID);

    // One hour out, and unambiguously in the future.
    expect(payload.exp).toBe(expiresAt);
    expect(expiresAt).toBeGreaterThan(after);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(expiresAt).toBeLessThanOrEqual(after + 3600);

    // Cloudflare caps exp at 24h past signing; staying well inside that is
    // what makes the token "short-lived" per spec §3.5a.
    expect(expiresAt).toBeLessThan(before + 24 * 3600);
  });

  it("signs with RS256 over header.payload, verifiable with the public key", () => {
    const { token } = createPlaybackToken(VIDEO_UID);
    const [rawHeader, rawPayload, signature] = token.split(".");

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${rawHeader}.${rawPayload}`);
    expect(
      verifier.verify(publicKey, Buffer.from(signature, "base64url"))
    ).toBe(true);
  });

  it("rejects a token signed for a different video", () => {
    // Proves `sub` is really bound by the signature, not just present in the
    // payload — a token that could be retargeted would defeat §3.5a entirely.
    const { token } = createPlaybackToken(VIDEO_UID);
    const [rawHeader, , signature] = token.split(".");

    const forgedPayload = Buffer.from(
      JSON.stringify({
        sub: "someone-elses-video",
        kid: SIGNING_KEY_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${rawHeader}.${forgedPayload}`);
    expect(
      verifier.verify(publicKey, Buffer.from(signature, "base64url"))
    ).toBe(false);
  });

  it("emits base64url segments with no padding or non-url characters", () => {
    const { token } = createPlaybackToken(VIDEO_UID);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("never calls Cloudflare — the whole point of local signing", () => {
    createPlaybackToken(VIDEO_UID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the PEM env var holds a raw PEM instead of base64", () => {
    // The likely paste error. Left unchecked it decodes to binary garbage and
    // fails inside OpenSSL with an unrecoverable message.
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", privateKey);

    expect(() => createPlaybackToken(VIDEO_UID)).toThrow(
      /did not base64-decode to a PEM/
    );
  });

  it("throws when the signing key id is unset", () => {
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "");

    expect(() => createPlaybackToken(VIDEO_UID)).toThrow(
      /CLOUDFLARE_STREAM_SIGNING_KEY_ID/
    );
  });
});

describe("describeStreamError", () => {
  it("names the duration cap rather than saying 'encoding failed'", () => {
    // The highest-value message in the map. Every upload is minted with
    // maxDurationSeconds=120 (§3.5d) and an over-length clip does not fail at
    // upload time — it uploads fine and errors during processing. It is the
    // most likely failure this feature will ever produce, and a generic
    // message would send Kelsey back to re-upload the same too-long file.
    const message = describeStreamError({
      errorCode: "ERR_DURATION_EXCEED_CONSTRAINT",
      errorReason: "The video is longer than the allowed duration.",
    });

    expect(message).toMatch(/longer than 2 minutes/);
    expect(message).toMatch(/Trim it/);
  });

  it("derives the cap from MAX_UPLOAD_DURATION_SECONDS, not from prose", () => {
    // Guards the wording against the constant moving. 120 renders as
    // "2 minutes"; if the cap changed and this string were hardcoded, the
    // message would confidently state the wrong limit.
    expect(
      describeStreamError({
        errorCode: "ERR_DURATION_EXCEED_CONSTRAINT",
        errorReason: null,
      })
    ).toContain("2 minutes");
  });

  it.each([
    ["ERR_DURATION_TOO_SHORT", /too short/i],
    ["ERR_MALFORMED_VIDEO", /damaged/i],
    ["ERR_FETCH_ORIGIN_ERROR", /couldn't read/i],
    ["ERR_UNKNOWN", /didn't say why/i],
  ])("maps %s to plain language with a next step", (code, matcher) => {
    const message = describeStreamError({
      errorCode: code,
      errorReason: "vendor text",
    });
    expect(message).toMatch(matcher);
    // Every branch tells her what to do, not just what broke.
    expect(message).toMatch(/again/i);
  });

  it("falls through an unrecognized code to Cloudflare's own text", () => {
    // A sixth code must degrade the wording, never lose the explanation.
    const message = describeStreamError({
      errorCode: "ERR_SOMETHING_NEW",
      errorReason: "A brand new vendor failure",
    });

    expect(message).toContain("A brand new vendor failure");
    expect(message).toMatch(/upload the clip again/);
  });

  it("still returns actionable copy when there is no code and no text", () => {
    expect(
      describeStreamError({ errorCode: null, errorReason: null })
    ).toMatch(/Remove it and upload the clip again/);
  });
});

describe("createPlaybackUrls", () => {
  /** The token Cloudflare expects in place of the UID, pulled back out. */
  function tokenFrom(url: string): string {
    return new URL(url).pathname.split("/")[1];
  }

  it("substitutes the signed token for the video uid in the path", async () => {
    const { iframeUrl, posterUrl } = createPlaybackUrls(VIDEO_UID);

    // This is the whole Cloudflare contract for signed playback: the token
    // goes where the UID would. A URL that still carried the raw UID would
    // 403 on every requireSignedURLs video.
    expect(iframeUrl.startsWith(`https://${CUSTOMER_SUBDOMAIN}/`)).toBe(true);
    expect(iframeUrl).not.toContain(VIDEO_UID);
    expect(posterUrl).not.toContain(VIDEO_UID);

    const token = tokenFrom(iframeUrl);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    expect(payload.sub).toBe(VIDEO_UID);

    expect(new URL(iframeUrl).pathname).toBe(`/${token}/iframe`);
    expect(new URL(posterUrl).pathname).toBe(
      `/${token}/thumbnails/thumbnail.jpg`
    );
  });

  it("requests a 9:16 poster frame, never a square crop", () => {
    // Cloudflare's thumbnail endpoint defaults to 640x640 with fit=crop, which
    // would centre-crop a vertical clip into a square and silently break the
    // "9:16 throughout, never cropped to square" rule in spec §3.9.
    const { posterUrl } = createPlaybackUrls(VIDEO_UID);
    const params = new URL(posterUrl).searchParams;

    const width = Number(params.get("width"));
    const height = Number(params.get("height"));
    expect(width / height).toBeCloseTo(9 / 16, 5);
    expect(params.get("fit")).toBe("crop");
  });

  it("takes the poster at 0s, an offset every valid clip has", () => {
    // Cloudflare's docs example uses 1s, but nothing enforces a minimum clip
    // length above 0.1s, so 1s can land past the end of a short video. A dark
    // first frame is cosmetic; a broken poster on a good video is not.
    expect(
      new URL(createPlaybackUrls(VIDEO_UID).posterUrl).searchParams.get("time")
    ).toBe("0s");
  });

  it("hands the player the same poster the tile shows", () => {
    const { iframeUrl, posterUrl } = createPlaybackUrls(VIDEO_UID);
    expect(new URL(iframeUrl).searchParams.get("poster")).toBe(posterUrl);
  });

  it("absorbs a subdomain pasted with a scheme or a trailing slash", () => {
    // Both produce `https://https://…`, which fails only in front of a client.
    vi.stubEnv(
      "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
      `https://${CUSTOMER_SUBDOMAIN}/`
    );

    const { iframeUrl } = createPlaybackUrls(VIDEO_UID);
    expect(new URL(iframeUrl).host).toBe(CUSTOMER_SUBDOMAIN);
    expect(iframeUrl).not.toContain("https://https://");
    expect(new URL(iframeUrl).pathname).not.toContain("//");
  });

  it("reports an expiry an hour out, matching the token it signed", () => {
    const before = Math.floor(Date.now() / 1000);
    const { iframeUrl, expiresAt } = createPlaybackUrls(VIDEO_UID);

    const payload = JSON.parse(
      Buffer.from(tokenFrom(iframeUrl).split(".")[1], "base64url").toString(
        "utf8"
      )
    );
    expect(payload.exp).toBe(expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600);
  });

  it("signs a verifiable token — the URL is not just a formatted string", () => {
    const { iframeUrl } = createPlaybackUrls(VIDEO_UID);
    const [rawHeader, rawPayload, signature] = tokenFrom(iframeUrl).split(".");

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${rawHeader}.${rawPayload}`);
    expect(
      verifier.verify(publicKey, Buffer.from(signature, "base64url"))
    ).toBe(true);
  });

  it("never calls Cloudflare — assembly is local, like the signing", () => {
    createPlaybackUrls(VIDEO_UID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the customer subdomain is unset", () => {
    // Without it there is no host to play from, and a silently malformed URL
    // would surface as a dead player rather than a build error.
    vi.stubEnv("CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN", "");

    expect(() => createPlaybackUrls(VIDEO_UID)).toThrow(
      /CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN/
    );
  });
});

describe("deleteVideo", () => {
  it("DELETEs the video by uid", async () => {
    fetchMock.mockResolvedValue(ok(null));

    await deleteVideo(VIDEO_UID);

    const [url, init] = callArgs();
    expect(url).toBe(`${STREAM_BASE}/${VIDEO_UID}`);
    expect(init.method).toBe("DELETE");
  });

  it("resolves on a success with an empty body", async () => {
    // Cloudflare's delete carries no payload; their SDK types it as void and
    // neither their docs nor the schema pin down whether a body is sent.
    fetchMock.mockResolvedValue(response(200, ""));

    await expect(deleteVideo(VIDEO_UID)).resolves.toBeUndefined();
  });

  it("throws rather than swallowing a failed delete", async () => {
    // Spec §3.5c: no foreign key protects this link. A swallowed failure here
    // orphans the video, which keeps billing storage minutes forever with
    // nothing anywhere surfacing an error. Callers must see this throw.
    fetchMock.mockResolvedValue(
      jsonResponse(500, {
        result: null,
        success: false,
        errors: [{ code: 10001, message: "Internal error" }],
        messages: [],
      })
    );

    await expect(deleteVideo(VIDEO_UID)).rejects.toThrow(
      /HTTP 500.*Internal error/
    );
  });

  it("throws on a 200 that carries success:false", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        result: null,
        success: false,
        errors: [{ code: 10006, message: "Resource not found" }],
        messages: [],
      })
    );

    await expect(deleteVideo(VIDEO_UID)).rejects.toThrow(
      /reported failure.*Resource not found/
    );
  });
});
