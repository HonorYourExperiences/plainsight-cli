import { cookies } from "next/headers";
import { db } from "./db";

export async function getSession(req?: Request) {
  const token = (await cookies()).get("tidy_session")?.value;
  if (!token) return null;
  const user = await db.user.findUnique({ where: { id: token } });
  return user ? { user } : null;
}
