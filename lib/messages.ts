/**
 * Hard cap on a stored message body. Single source of truth shared by the API
 * route (`app/api/messages/route.ts`, which enforces it server-side) and the
 * composer (`components/messages/MessageThread.tsx`, which sets `maxLength` and
 * renders the live character counter). Just the number — no server imports, so
 * it's safe to pull into the client bundle.
 */
export const MESSAGE_MAX_LENGTH = 5000;
