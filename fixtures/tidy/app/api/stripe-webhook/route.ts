import { db } from "@/lib/db";

export async function POST(req: Request) {
  const event = await req.json();
  if (event.type === "checkout.session.completed") {
    const email = event.data.object.customer_email;
    await db.user.update({ where: { email }, data: { pro: true } });
  }
  return new Response("ok");
}
