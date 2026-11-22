import { NextResponse } from "next/server";
import { getSession } from "./lib/auth";

export async function middleware(req: Request) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.redirect(new URL("/signup", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/checkout", "/pro"],
};
