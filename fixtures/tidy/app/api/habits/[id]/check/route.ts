import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) {
    return new Response(null, { status: 401 });
  }
  const habit = await db.habit.update({
    where: { id: params.id, userId: session.user.id },
    data: { checks: { push: new Date() } },
  });
  return Response.json(habit);
}
