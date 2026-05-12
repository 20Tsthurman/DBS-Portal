#!/usr/bin/env node
// Dev-only helper: signs and POSTs synthetic Clerk webhook events to the
// local endpoint. NOT for production use. See README → "Local webhook
// development → Using the dev test script" for the full guide.
//
// Run via `npm run test:webhook -- <kind> [options]` so .env.local is loaded.

import { Webhook } from "svix";
import { randomBytes } from "node:crypto";

const HELP = `Usage: npm run test:webhook -- <kind> [options]

Kinds:
  linked            role=client + a real clientId (requires --client-id=<uuid>)
  already_linked    re-fire of "linked" — pass the same --client-id and --user-id
  no_match          role=client with a clientId that doesn't exist in Supabase
  no_client_id      role=client but no publicMetadata.clientId (regression check)
  skipped           no role and no clientId (mimics owner/manual signup)

Options:
  --client-id=<uuid>   Required for linked/already_linked.
  --user-id=<id>       Override the synthetic Clerk user id (use the same value
                       across linked + already_linked to test idempotency).
  --url=<url>          Endpoint URL. Default: http://localhost:3000/api/webhooks/clerk
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (const tok of argv) {
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq > -1) args[tok.slice(2, eq)] = tok.slice(eq + 1);
      else args[tok.slice(2)] = true;
    } else {
      args._.push(tok);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const kind = args._[0];

if (!kind || args.help) {
  process.stdout.write(HELP);
  process.exit(kind ? 0 : 1);
}

const secret = process.env.CLERK_WEBHOOK_SECRET;
if (!secret) {
  console.error(
    "CLERK_WEBHOOK_SECRET is not set. Run via `npm run test:webhook -- ...` so --env-file=.env.local takes effect."
  );
  process.exit(1);
}

const url = args.url ?? "http://localhost:3000/api/webhooks/clerk";
const userId = args["user-id"] ?? `user_test_${randomBytes(6).toString("hex")}`;
const requestedClientId = args["client-id"];

let publicMetadata = {};
const privateMetadata = {};

switch (kind) {
  case "linked":
  case "already_linked":
    if (!requestedClientId) {
      console.error(`Kind "${kind}" requires --client-id=<uuid>.`);
      process.exit(1);
    }
    publicMetadata = { role: "client", clientId: requestedClientId };
    break;
  case "no_match":
    publicMetadata = {
      role: "client",
      clientId:
        requestedClientId ?? "00000000-0000-0000-0000-000000000000",
    };
    break;
  case "no_client_id":
    publicMetadata = { role: "client" };
    break;
  case "skipped":
    publicMetadata = {};
    break;
  default:
    console.error(`Unknown kind: ${kind}`);
    process.stdout.write(HELP);
    process.exit(1);
}

const event = {
  type: "user.created",
  object: "event",
  data: {
    id: userId,
    email_addresses: [
      { id: "idn_test", email_address: "webhook-test@example.com" },
    ],
    public_metadata: publicMetadata,
    private_metadata: privateMetadata,
  },
};

const payload = JSON.stringify(event);
const msgId = `msg_test_${randomBytes(6).toString("hex")}`;
const now = new Date();
const timestamp = Math.floor(now.getTime() / 1000).toString();

const wh = new Webhook(secret);
const signature = wh.sign(msgId, now, payload);

console.log(`→ POST ${url}`);
console.log(
  `  kind=${kind} userId=${userId}${
    requestedClientId ? ` clientId=${requestedClientId}` : ""
  }`
);

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "svix-id": msgId,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  },
  body: payload,
});

const body = await res.text();
console.log(`← ${res.status} ${res.statusText}`);
console.log(`  ${body}`);
process.exit(res.status >= 200 && res.status < 300 ? 0 : 2);
