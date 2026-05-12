import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes that must bypass Clerk auth entirely. The Clerk webhook
// endpoint is called by Clerk's servers (via Svix), which do not carry
// session cookies, so it must never be gated by auth.protect().
const isPublicRoute = createRouteMatcher(["/api/webhooks(.*)"]);

const isProtectedRoute = createRouteMatcher([
  "/owner(.*)",
  "/client(.*)",
  "/api/invite(.*)",
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
