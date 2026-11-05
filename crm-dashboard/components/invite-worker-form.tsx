"use client";

import { FormEvent, useState, useTransition } from "react";
import { inviteWorker } from "@/app/actions";

export default function InviteWorkerForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    startTransition(async () => {
      try {
        setMessage(await inviteWorker(email));
        setEmail("");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not invite this worker.");
      }
    });
  }

  return (
    <form className="invite-form" onSubmit={submit}>
      <span className="section-eyebrow">Team access</span>
      <h3>Invite a worker</h3>
      <p>They will receive an email invitation and can then sign in with a secure email link.</p>
      <label htmlFor="worker-email">Worker email</label>
      <input
        id="worker-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="name@company.com"
        disabled={isPending}
      />
      <button className="button button-secondary full-width" type="submit" disabled={isPending}>
        {isPending ? "Sending invitation…" : "Send invitation"}
      </button>
      {message && <p className="form-message success-message">{message}</p>}
      {error && <p className="form-message error-message">{error}</p>}
    </form>
  );
}
