import { deleteNote } from "./actions";
import { getNotesFor } from "@/lib/db/queries";
import { currentUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Settings() {
  const user = await currentUser();
  if (!user) redirect("/");
  const mine = await getNotesFor(user.id);
  return <form action={deleteNote}>{mine.length}</form>;
}
