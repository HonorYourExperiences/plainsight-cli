import { stripe, PRO_PRICE } from "@/lib/stripe";
import { getSession } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return new Response(null, { status: 401 });

  const checkout = await stripe.checkout.sessions.create({
    customer_email: session.user.email,
    line_items: [{ price: PRO_PRICE, quantity: 1 }],
    mode: "subscription",
    success_url: "https://tidy.app/dashboard",
  });

  return Response.json({ url: checkout.url });
}
