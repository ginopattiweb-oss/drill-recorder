import { NextResponse, type NextRequest } from "next/server";
import { isOwnerToken, OWNER_COOKIE } from "@/lib/auth";

// Solo el dueño ve la librería, graba, renombra y borra. Los links /share son públicos.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const m = req.method;
  const ownerOnly =
    pathname === "/" ||
    pathname === "/api/videos" ||
    pathname.startsWith("/api/upload/") ||
    pathname.endsWith("/transcribe") ||
    (/^\/api\/videos\/[^/]+$/.test(pathname) && (m === "PATCH" || m === "DELETE"));
  if (!ownerOnly || (await isOwnerToken(req.cookies.get(OWNER_COOKIE)?.value))) return NextResponse.next();
  if (pathname.startsWith("/api")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/", "/api/videos/:path*", "/api/upload/:path*"] };
