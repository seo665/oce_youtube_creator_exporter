"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-mark">C</div>
        <span className="eyebrow">Private workspace</span>
        <h1>Set your password</h1>
        <p className="login-copy">
          Use a unique password with at least 12 characters.
        </p>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            autoComplete="new-password"
            type="password"
            minLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            autoComplete="new-password"
            type="password"
            minLength={12}
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={busy}
          />
          {error && <p className="form-message error-message">{error}</p>}
          <button className="button button-primary full-width" type="submit" disabled={busy}>
            {busy ? "Updating…" : "Save password"}
          </button>
        </form>
      </section>
    </main>
  );
}
