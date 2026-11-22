import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { resend } from "@/lib/email";
import { track } from "@/lib/analytics";

export async function POST(req: Request) {
  const { email, password } = await req.json();

  const hash = await bcrypt.hash(password, 12);
  const user = await db.user.create({ data: { email, hash } });
  await track("signup", user.id);
  await resend.emails.send({ from: "hi@tidy.app", to: email, subject: "Welcome", html: "<p>Welcome</p>" });

  return Response.json({ id: user.id });
}
