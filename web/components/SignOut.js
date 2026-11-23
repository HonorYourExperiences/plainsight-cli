"use client";
import { authClient } from "@/lib/auth-client.mjs";

export default function SignOut() {
  return <button onClick={async () => { await authClient.signOut(); window.location.href = "/"; }}>Sign out</button>;
}
