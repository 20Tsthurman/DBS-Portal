import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";

import {
  createDirectUploadUrl,
  createPlaybackToken,
  deleteVideo,
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
