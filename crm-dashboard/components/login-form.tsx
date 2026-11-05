"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ inviteFailed = false }: { inviteFailed?: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(
    inviteFailed ? "That invitation link could not be verified. Request a new sign-in link." : "",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (authError) throw authError;
      setSent(true);
      setMessage("A secure sign-in link has been sent. Open it on this device to continue.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed. Please try again.");
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
          Sign in with an invited work email. New accounts cannot register themselves.
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
          {message && <p className="form-message success-message">{message}</p>}
          {error && <p className="form-message error-message">{error}</p>}
          <button className="button button-primary full-width" type="submit" disabled={busy}>
            {busy ? "Sending…" : sent ? "Send another sign-in link" : "Email me a sign-in link"}
          </button>
        </form>
        <p className="login-footnote">Access is limited to accounts invited by the workspace admin.</p>
      </section>
    </main>
  );
}
