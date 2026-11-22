import { getServerSession } from "next-auth";
import { legacy } from "@/lib/prisma";

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!(await canEdit(params.id))) return new Response(null, { status: 403 });
  await legacy.post.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
}

async function canEdit(postId: string) {
  const session = await getServerSession();
  const count = await legacy.post.count({ where: { id: postId, authorId: session?.user.id } });
  return count > 0;
}
