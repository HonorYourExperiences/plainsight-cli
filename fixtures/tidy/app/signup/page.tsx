"use client";
import { useState } from "react";
import { Button } from "@/components/Button";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit() {
    await fetch("/api/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    window.location.href = "/dashboard";
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button>Create account</Button>
    </form>
  );
}
