"use client";
import { stripe, PRO_PRICE } from "@/lib/stripe";

export default function ProPage() {
  async function upgrade() {
    const res = await fetch("/api/checkout", { method: "POST" });
    const { url } = await res.json();
    window.location.href = url;
  }

  return (
    <main>
      <h1>Tidy Pro</h1>
      <p>Unlimited habits for $4/month. Plan: {PRO_PRICE}</p>
      <button onClick={upgrade}>Upgrade to Pro</button>
    </main>
  );
}
