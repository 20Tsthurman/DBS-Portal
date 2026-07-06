import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes that must bypass Clerk auth entirely. The Clerk webhook
// endpoint is called by Clerk's servers (via Svix), which do not carry
// session cookies, so it must never be gated by auth.protect().
const isPublicRoute = createRouteMatcher(["/api/webhooks(.*)"]);

// Defense-in-depth: these API routes also enforce auth in-handler
// (requireOwnerApi / requireOwnerOrClientApi). Listing them here adds a
// middleware-level backstop so a logged-out request is stopped before it
// ever reaches the handler. NOT included, intentionally:
//   - /api/cron/*    — authenticated by Bearer CRON_SECRET, not a Clerk
//                      session; Clerk's auth.protect() would break it.
//   - /api/webhooks/* — verified by signature (svix / Stripe), not session;
//                       handled by isPublicRoute below.
const isProtectedRoute = createRouteMatcher([
  "/owner(.*)",
  "/client(.*)",
  "/api/invite(.*)",
  "/api/messages(.*)",
  "/api/clients(.*)",
  // Google OAuth (connect/callback) + sync-on-view. All session-carrying:
  // the callback is Google redirecting Kelsey's own browser, so her Clerk
  // cookies ARE present — this must NOT move to the public webhook matcher.
  "/api/google(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
