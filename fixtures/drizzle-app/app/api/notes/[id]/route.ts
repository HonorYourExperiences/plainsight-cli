import { getNote } from "@/lib/db/queries";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const note = await getNote(Number(params.id));
  return Response.json(note);
}
