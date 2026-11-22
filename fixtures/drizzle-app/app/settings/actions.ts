"use server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { getUser } from "@/lib/db/queries";
import { withUser } from "@/lib/session";

// login checked by the wrapper
export const deleteNote = withUser(async (data, user) => {
  const id = Number(data.get("id"));
  await db.delete(notes).where(eq(notes.id, id));
});

// a lookup by email, not a login check
export async function register(data: FormData) {
  const email = String(data.get("email"));
  const [existing] = await getUser(email);
  if (existing) return { error: "exists" };
}
