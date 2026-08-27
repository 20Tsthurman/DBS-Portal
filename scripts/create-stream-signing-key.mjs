#!/usr/bin/env node
// One-off setup helper: creates a Cloudflare Stream URL signing key and
// prints it to stdout. Cloudflare exposes NO dashboard UI for signing keys
// — the API is the only way to create one.
//
// The key backs the short-lived playback tokens required by the content
// spec §3.5a (`requireSignedURLs` on every video). `lib/stream.ts` will
// consume the printed values in Phase 2B; this script exists only to
// obtain them.
//
// There is no npm script for this — it is run once. Load .env.local
// explicitly, matching how `test:webhook` does it:
//   node --env-file=.env.local scripts/create-stream-signing-key.mjs
//
// NOTHING IS WRITTEN TO DISK. Cloudflare displays key material exactly
// once, at creation — there is no way to read the PEM back later. Copy the
// two printed values into .env.local and into Vercel's environment
// variables by hand. Re-running this mints an ADDITIONAL key; it does not
// re-show the previous one.

const ENDPOINT_BASE = "https://api.cloudflare.com/client/v4";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_STREAM_TOKEN;

const missing = [];
if (!accountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
if (!apiToken) missing.push("CLOUDFLARE_STREAM_TOKEN");

if (missing.length > 0) {
  console.error(
    `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`
  );
  console.error(
    "Run via `node --env-file=.env.local scripts/create-stream-signing-key.mjs` so .env.local is loaded."
  );
  process.exit(1);
}

// Guard against minting an orphan. Once a key has been pasted into
// .env.local, a second run creates a second key that nothing references
// and that can never be recovered — the PEM is shown once. Cloudflare
// permits multiple keys per account, so it will happily do this.
if (process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID && !force) {
  console.error(
    `CLOUDFLARE_STREAM_SIGNING_KEY_ID is already set (${process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID}).`
  );
  console.error(
    "A key already exists for this environment. Re-run with --force only if you intend to mint a second one."
  );
  process.exit(1);
}

const url = `${ENDPOINT_BASE}/accounts/${accountId}/stream/keys`;

console.log(`→ POST ${url}`);

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  },
  // The endpoint takes no body parameters; an empty JSON object is the
  // documented request shape.
  body: "{}",
});

const raw = await res.text();
let payload = null;
try {
  payload = JSON.parse(raw);
} catch {
  // Non-JSON body — reported verbatim below.
}

console.log(`← ${res.status} ${res.statusText}`);

if (!res.ok || payload?.success !== true) {
  console.error("");
  console.error("Cloudflare rejected the request. No key was created.");
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`  [${err.code ?? "?"}] ${err.message ?? JSON.stringify(err)}`);
    }
  } else {
    console.error(`  ${raw.slice(0, 500)}`);
  }
  if (res.status === 401 || res.status === 403) {
    console.error(
      "  Check that CLOUDFLARE_STREAM_TOKEN is a Stream:Edit-scoped token for this account,"
    );
    console.error("  and that CLOUDFLARE_ACCOUNT_ID matches the account the token was issued under.");
  }
  process.exit(2);
}

const key = payload.result ?? {};

if (!key.id || !key.pem) {
  console.error("");
  console.error(
    "Cloudflare reported success but returned no key material. Nothing usable was produced."
  );
  console.error(`  ${raw.slice(0, 500)}`);
  process.exit(2);
}

// Cloudflare returns `pem` and `jwk` BASE64-ENCODED. The base64 form is
// what belongs in the env var: it is a single line, so it survives .env
// parsing and Vercel's environment UI intact, where a real multi-line PEM
// would not. `lib/stream.ts` must base64-decode it before signing:
//   Buffer.from(process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM, "base64")
// The decode below is a sanity check only — the decoded key is never
// printed in full.
const decoded = Buffer.from(key.pem, "base64").toString("utf8");
const firstLine = decoded.split("\n")[0]?.trim() ?? "";
const looksLikePem = firstLine.startsWith("-----BEGIN");

console.log("");
console.log("Stream signing key created. Cloudflare will NOT show the PEM again.");
console.log("Paste both values into .env.local and into Vercel (all environments).");
console.log("");
console.log("────────────────────────────────────────────────────────────────");
console.log(`CLOUDFLARE_STREAM_SIGNING_KEY_ID=${key.id}`);
console.log("");
console.log(`CLOUDFLARE_STREAM_SIGNING_KEY_PEM=${key.pem}`);
console.log("────────────────────────────────────────────────────────────────");
console.log("");
console.log(`  created:  ${key.created ?? "(not returned)"}`);
console.log(`  jwk:      ${key.jwk ? "also returned, not needed — the PEM is what we sign with" : "(not returned)"}`);
if (looksLikePem) {
  console.log(`  pem:      base64; decodes to "${firstLine}" — decode before use`);
} else {
  console.log("  pem:      WARNING — base64 did not decode to a PEM header.");
  console.log("            Paste it anyway (it is the value Cloudflare issued), but");
  console.log("            verify the encoding before lib/stream.ts relies on it.");
}
console.log("");
console.log("Do not commit these. Nothing was written to disk by this script.");
