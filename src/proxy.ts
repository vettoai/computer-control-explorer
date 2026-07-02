// Optional shared-password gate, enabled by setting EXPLORER_PASSWORD at runtime
// (server builds only: Docker / `next start` / `next dev`). Without the variable this
// is a no-op passthrough. The static export never includes proxies — `next build` with
// `output: "export"` omits this file with a warning — so exports are always
// passwordless by construction (the content is baked into the HTML anyway).
//
// The login form POSTs back to /login and is handled entirely here, so the app needs
// no API routes (which would break the export build). A valid login sets an httpOnly
// cookie holding a salted digest of the password; requests without it are redirected
// to /login.
import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_COOKIE,
  authTokenFor,
  isValidAuthCookie,
  passwordMatches,
  safeRedirectPath,
} from "@/lib/auth";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function proxy(request: NextRequest) {
  const password = process.env.EXPLORER_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  const authed = cookie !== undefined && isValidAuthCookie(cookie, password);

  if (pathname === "/login") {
    if (request.method === "POST") return handleLogin(request, password);
    if (authed) {
      const from = safeRedirectPath(request.nextUrl.searchParams.get("from"));
      return NextResponse.redirect(new URL(from, request.url));
    }
    return NextResponse.next();
  }

  if (authed) return NextResponse.next();

  const login = new URL("/login", request.url);
  const from = pathname + search;
  if (from !== "/") login.searchParams.set("from", from);
  return NextResponse.redirect(login);
}

async function handleLogin(request: NextRequest, password: string) {
  const form = await request.formData();
  const supplied = form.get("password");
  const from = safeRedirectPath(form.get("from"));

  if (typeof supplied === "string" && passwordMatches(supplied, password)) {
    const response = NextResponse.redirect(new URL(from, request.url), 303);
    response.cookies.set(AUTH_COOKIE, authTokenFor(password), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  }

  const retry = new URL("/login", request.url);
  retry.searchParams.set("error", "1");
  if (from !== "/") retry.searchParams.set("from", from);
  return NextResponse.redirect(retry, 303);
}

export const config = {
  // Gate everything except the build assets the login page itself needs. Public
  // files are only logos/icons (*.svg, favicon); all dataset content is rendered
  // inside page routes, which stay matched.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.svg$).*)"],
};
