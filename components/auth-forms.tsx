"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    router.replace("/chat"); router.refresh();
  }

  return (
    <form className="form-grid" onSubmit={onSubmit}>
      {error && <div className="error">{error}</div>}
      <label className="field"><span className="label">Email</span><input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label className="field"><span className="label">Password</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></label>
      <button className="button button-primary" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setSuccess("");
    const origin = window.location.origin;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name.trim() || "New user" }, emailRedirectTo: `${origin}/auth/callback` },
    });
    if (error) { setError(error.message); setLoading(false); return; }
    if (data.session) { router.replace("/chat"); router.refresh(); return; }
    setSuccess("Account created. Check your email to confirm your address, then sign in.");
    setLoading(false);
  }

  return (
    <form className="form-grid" onSubmit={onSubmit}>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
      <label className="field"><span className="label">Display name</span><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Alex" maxLength={40} /></label>
      <label className="field"><span className="label">Email</span><input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label className="field"><span className="label">Password</span><input className="input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></label>
      <button className="button button-primary" disabled={loading}>{loading ? "Creating…" : "Create account"}</button>
    </form>
  );
}
