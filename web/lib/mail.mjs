// Sends the one-time sign-in link. Uses Resend when RESEND_API_KEY is set.
// Without it (local development only) the link is written to the server log and to
// .data/last-sign-in-link.txt, so you can sign in without an email provider.
import fs from "node:fs";
import path from "node:path";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function sendSignInEmail(email, url) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("Email sign-in isn't set up on this site yet (RESEND_API_KEY is missing).");
    const file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data/last-sign-in-link.txt");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${email}\n${url}\n`);
    console.log(`\n[plainsight] Sign-in link for ${email} (development, no email sent):\n${url}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Plainsight <sign-in@resend.dev>",
      to: [email],
      subject: "Your Plainsight sign-in link",
      text: `Sign in to Plainsight:\n\n${url}\n\nThe link works once and expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      html: `<p>Sign in to Plainsight:</p><p><a href="${esc(url)}">Sign in</a></p><p style="color:#666">The link works once and expires in 10 minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`The email provider refused the message (${res.status}).`);
}
