"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ authError = "" }: { authError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(authError);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError) throw authError;
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
        },
      );
      if (authError) throw authError;
      setMessage("If an invited account exists for that email, a password reset link has been sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not request a password reset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-mark">C</div>
        <span className="eyebrow">Private workspace</span>
        <h1>Creator CRM</h1>
        <p className="login-copy">
          Sign in with the work email and password for your invited account.
        </p>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="login-email">Work email</label>
          <input
            id="login-email"
            autoComplete="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            placeholder="you@company.com"
          />
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            autoComplete="current-password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            placeholder="Your password"
          />
          {message && <p className="form-message success-message">{message}</p>}
          {error && <p className="form-message error-message">{error}</p>}
          <button className="button button-primary full-width" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={requestPasswordReset}
            disabled={busy || !email.trim()}
          >
            Forgot or need to set your password?
          </button>
        </form>
        <p className="login-footnote">
          Access is limited to accounts invited by the workspace administrator.
        </p>
      </section>
    </main>
  );
}
