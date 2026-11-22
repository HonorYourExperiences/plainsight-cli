import { eq } from "drizzle-orm";
import { db } from "./index";
import { users, notes } from "./schema";

export async function getUser(email: string) {
  return db.select().from(users).where(eq(users.email, email));
}

export async function getNotesFor(userId: number) {
  return db.select().from(notes).where(eq(notes.userId, userId));
}

export async function getNote(id: number) {
  return db.query.notes.findFirst({ where: eq(notes.id, id) });
}
