// Turns one finding into a prompt the user can paste into an AI coding tool
// (Claude, Cursor, Lovable...). Everything in it comes from the graph: the
// finding, its receipts and the stack Plainsight detected. Nothing is guessed.

const SEV = { crit: "Fix now", warn: "Fix soon", info: "Review" };

// What a good fix looks like, per rule. Written as instructions to the AI tool:
// say what "fixed" means and what not to do, without dictating one exact code
// change, because the right change depends on the app's own login helper.
const GUIDE = {
  "others-records":
    "Make the handler find out who is logged in (using the app's existing login helper) and only use records that belong to that user. " +
    "Return 401 when nobody is logged in and 404 when the record belongs to someone else. Don't trust a user id that comes from the request.",
  "logged-out-owner":
    "The ownership filter uses the session's user id directly. When nobody is logged in that value is undefined, and Prisma drops undefined filters, so the check matches every record. " +
    "Stop early with 401 when there is no logged-in user, before any database call, then keep the ownership filter.",
  "secret-in-browser":
    "Move the secret key into a server-only environment variable and move the code that uses it into a server route or server action, so the browser asks the server instead of holding the key. " +
    "Don't rename it to a NEXT_PUBLIC_ variable or pass it to client components: that still sends it to the browser. " +
    "Then tell me to roll (replace) the key in the provider's dashboard, because the old one has already been shipped to visitors.",
  "secret-in-code":
    "Move the key into an environment variable that is only read on the server, and tell me to rotate the key, because it is already in the code history.",
  "unsigned-webhook":
    "Verify the sender's signature before reading the body or touching the database, using the provider's own verification function and a webhook secret from an environment variable. " +
    "Reject the request with 400 if the signature is missing or wrong.",
  "partial-login":
    "Make the login check cover every case: stop the request unless a user is logged in, not only for the one condition it checks now.",
  "login-not-enforced":
    "The handler looks up the login but carries on either way. Return 401 when there is no logged-in user, before doing anything else.",
  "missing-route":
    "Either add the missing route handler or change the call to the address and method that already exist. Check which one the page actually needs before choosing.",
  "open-route":
    "Decide whether this route is meant to be public (sign-up and public data often are). If it isn't, add the app's existing login check. If it is, leave it and say so.",
  "public-lookup":
    "Check whether these records are meant to be public. If they aren't, require a login and only return the logged-in user's records.",
  "fails-after-save":
    "Make the request not fail after the data was saved: catch errors from the outside call and handle them (log, retry later or tell the user) so the saved data and the response agree.",
  "placeholder-link":
    "Replace the placeholder in this link with the real address, or remove the link if the page doesn't exist yet.",
};

// Secrets that slipped into a code snippet are masked before anything is copied,
// so pasting the prompt into an AI chat never hands the key to another company.
const SECRET = /(sk_(?:live|test)_|rk_(?:live|test)_|sk-(?:ant-|proj-)?|AKIA|ghp_|gho_|github_pat_|xox[abpr]-|re_|whsec_)([A-Za-z0-9]{4})[A-Za-z0-9_-]{6,}/g;
export const redact = (code = "") => code.replace(SECRET, "$1$2…");

function stackLine(stack = {}) {
  const parts = [];
  if (stack.nextAppRouter) parts.push("Next.js App Router");
  if (stack.nextPagesRouter) parts.push("Next.js Pages Router");
  if (stack.prisma) parts.push("Prisma");
  if (stack.drizzle) parts.push("Drizzle");
  if (stack.supabase || stack.sqlSchema?.length) parts.push(stack.supabase ? "Supabase" : "SQL schema files");
  if (stack.middleware) parts.push(`middleware in ${stack.middleware}`);
  return parts.join(", ");
}

export function fixPrompt(finding, graph = {}) {
  const node = (graph.nodes || []).find((n) => n.id === finding.node);
  const ev = finding.evidence || [];
  const first = ev[0];
  const where = [node ? (node.kind === "route" && node.method && node.method !== "ANY" ? `${node.method} ${node.name}` : node.name) : null, first ? `${first.file}:${first.line}` : finding.file].filter(Boolean).join(" · ");
  const stack = stackLine(graph.stack);
  const guide = GUIDE[finding.rule];

  const out = [
    `Plainsight (a code checker) found a problem in my app${graph.app ? ` "${graph.app}"` : ""}. Please fix only this problem, with the smallest change that does it, and don't change anything unrelated.`,
    "",
    `Problem (${SEV[finding.sev] || "Review"}): ${finding.title}`,
  ];
  if (where) out.push(`Where: ${where}`);
  if (stack) out.push(`Stack: ${stack}`);
  out.push(`What's wrong: ${finding.text}`);
  if (ev.length) {
    out.push("", ev.length > 1 ? "The code involved, in order:" : "The code involved:");
    for (const e of ev) {
      out.push(`${e.file}:${e.line}${e.endLine && e.endLine !== e.line ? `-${e.endLine}` : ""}`);
      out.push(...redact(e.code).split("\n").map((l) => "    " + l));
    }
  }
  if (guide) out.push("", `How to fix it: ${guide}`);
  out.push(
    "",
    "Before you change anything, read the files above and tell me in one or two sentences what you plan to do. " +
      "If the app already has a helper for this (a login check, a database client, a config file), use it instead of writing a new one. " +
      "When you're done, list the files you changed. I'll run `npx plainsight-cli` again to confirm the finding is gone.",
  );
  return out.join("\n");
}
