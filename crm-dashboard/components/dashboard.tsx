"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveLead } from "@/app/actions";
import InviteWorkerForm from "@/components/invite-worker-form";
import LeadImport from "@/components/lead-import";
import { createClient } from "@/lib/supabase/client";
import type { CrmProfile, Lead, LeadStatus } from "@/lib/types";

const statusLabels: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  qualified: "Qualified",
  not_interested: "Not interested",
  do_not_contact: "Do not contact",
};

const statusOptions = Object.entries(statusLabels) as [LeadStatus, string][];

type Props = {
  currentUser: CrmProfile;
  leads: Lead[];
  profiles: CrmProfile[];
};

type EmailFilter = "all" | "has_email" | "manual_check";

export default function Dashboard({ currentUser, leads: initialLeads, profiles }: Props) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const isAdmin = currentUser.role === "admin";
  const today = localDate();
  const selectedLead = leads.find((lead) => lead.id === selectedId) ?? null;
  const dueCount = leads.filter(
    (lead) => lead.follow_up_date && lead.follow_up_date <= today && !isClosed(lead.crm_status),
  ).length;
  const emailCount = leads.filter((lead) => hasPublicEmail(lead)).length;
  const manualCheckCount = leads.length - emailCount;
  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (statusFilter !== "all" && lead.crm_status !== statusFilter) return false;
      if (emailFilter === "has_email" && !hasPublicEmail(lead)) return false;
      if (emailFilter === "manual_check" && hasPublicEmail(lead)) return false;
      if (followUpOnly && (!lead.follow_up_date || lead.follow_up_date > today || isClosed(lead.crm_status))) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        lead.channel_name,
        lead.public_email,
        lead.channel_id,
        lead.data.source_keywords_all,
        lead.data.channel_description,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [emailFilter, followUpOnly, leads, search, statusFilter, today]);

  async function handleSave(input: {
    status: LeadStatus;
    notes: string;
    followUpDate: string;
    assignedTo: string;
  }) {
    if (!selectedLead) return;
    setBusy(true);
    setFeedback("");
    setError("");

    try {
      await saveLead({
        id: selectedLead.id,
        ...input,
      });
      setLeads((current) =>
        current.map((lead) =>
          lead.id === selectedLead.id
            ? {
                ...lead,
                crm_status: input.status,
                notes: input.notes,
                follow_up_date: input.followUpDate || null,
                assigned_to: isAdmin ? input.assignedTo || null : lead.assigned_to,
                updated_at: new Date().toISOString(),
              }
            : lead,
        ),
      );
      setFeedback("Lead saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this lead.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const supabase = createClient();
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(`Could not sign out: ${signOutError.message}`);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  function exportLeads() {
    const sourceColumns = Array.from(
      new Set(filteredLeads.flatMap((lead) => Object.keys(lead.data))),
    );
    const headers = [...sourceColumns, "crm_status", "assigned_to", "crm_notes", "follow_up_date"];
    const csvRows = [
      headers,
      ...filteredLeads.map((lead) => [
        ...sourceColumns.map((column) => lead.data[column] ?? ""),
        lead.crm_status,
        profiles.find((profile) => profile.id === lead.assigned_to)?.email ??
          (lead.assigned_to === currentUser.id ? currentUser.email : ""),
        lead.notes,
        lead.follow_up_date ?? "",
      ]),
    ];
    const csv = csvRows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value);
            const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
            return `"${safe.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const exportName =
      emailFilter === "has_email"
        ? "creator-crm-public-emails.csv"
        : emailFilter === "manual_check"
          ? "creator-crm-manual-email-check.csv"
          : "creator-crm-leads.csv";
    link.download = exportName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">C</div>
          <div>
            <strong>Creator CRM</strong>
            <span>Private workspace</span>
          </div>
        </div>

        <div className="sidebar-section-label">Workspace</div>
        <a className="nav-link nav-link-active" href="#leads">
          <span className="nav-icon">▦</span> Leads
          <span className="nav-count">{leads.length}</span>
        </a>
        <button
          className={`nav-link ${followUpOnly ? "nav-link-active" : ""}`}
          type="button"
          onClick={() => {
            setFollowUpOnly((value) => !value);
            document.getElementById("leads")?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <span className="nav-icon">◷</span> Follow-ups
          {dueCount > 0 && <span className="nav-count nav-count-alert">{dueCount}</span>}
        </button>

        <div className="sidebar-bottom">
          {isAdmin && (
            <>
              <LeadImport />
              <InviteWorkerForm />
            </>
          )}
          <div className="account-card">
            <div className="avatar">{initials(currentUser.email)}</div>
            <div className="account-copy">
              <strong>{currentUser.email}</strong>
              <span>{isAdmin ? "Administrator" : "Worker"}</span>
            </div>
            <button className="icon-button signout-button" onClick={signOut} title="Sign out" aria-label="Sign out">
              ↗
            </button>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> Leads</div>
          <div className="run-chip"><i /> Last search · Nov 5, 2026</div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <span className="eyebrow">OnlyFans creator search</span>
              <h1>Leads</h1>
              <p>One focused search run, ready for your team to qualify and follow up.</p>
            </div>
            <button className="button button-secondary export-button" onClick={exportLeads} disabled={!filteredLeads.length}>
              <span>↓</span> Export CSV
            </button>
          </section>

          <section className="stats-grid" aria-label="Lead summary">
            <StatCard label="Total leads" value={leads.length.toLocaleString()} icon="▦" detail="From the latest search" />
            <StatCard label="Public emails" value={emailCount.toLocaleString()} icon="✉" detail="Listed publicly by creators" />
            <StatCard label="Manual email check" value={manualCheckCount.toLocaleString()} icon="⌕" detail="No public email listed" />
            <StatCard label="Needs follow-up" value={dueCount.toLocaleString()} icon="◷" detail="Due today or overdue" accent={dueCount > 0} />
          </section>

          {dueCount > 0 && !followUpOnly && (
            <button className="followup-banner" onClick={() => setFollowUpOnly(true)}>
              <span className="banner-icon">◷</span>
              <span><strong>{dueCount} follow-up{dueCount === 1 ? "" : "s"} due</strong> — review the next steps your team scheduled.</span>
              <span className="banner-action">View follow-ups →</span>
            </button>
          )}

          <section className="lead-panel" id="leads">
            <div className="panel-heading">
              <div>
                <h2>Creator leads <span className="heading-count">{filteredLeads.length}</span></h2>
                <p>Separate leads with a listed email from those needing manual contact research.</p>
              </div>
              {followUpOnly && (
                <button className="text-button clear-filter" onClick={() => setFollowUpOnly(false)}>
                  Clear follow-up filter ×
                </button>
              )}
            </div>

            <div className="filters-row">
              <label className="search-box">
                <span>⌕</span>
                <input
                  type="search"
                  placeholder="Search leads, emails, keywords…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label className="filter-select">
                <span>Email</span>
                <select value={emailFilter} onChange={(event) => setEmailFilter(event.target.value as EmailFilter)}>
                  <option value="all">All leads ({leads.length.toLocaleString()})</option>
                  <option value="has_email">Has public email ({emailCount.toLocaleString()})</option>
                  <option value="manual_check">Needs manual check ({manualCheckCount.toLocaleString()})</option>
                </select>
              </label>
              <label className="filter-select">
                <span>Status</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              {followUpOnly && <span className="filter-pill">Due now</span>}
            </div>

            {error && <p className="inline-alert error-message">{error}</p>}
            <div className="table-scroll">
              <table className="leads-table">
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Public email</th>
                    <th>Status</th>
                    <th>Subscribers</th>
                    <th>Follow-up</th>
                    <th aria-label="Open lead" />
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map((lead) => (
                    <tr
                      className={selectedId === lead.id ? "selected-row" : ""}
                      key={lead.id}
                      onClick={() => {
                        setSelectedId(lead.id);
                        setFeedback("");
                        setError("");
                      }}
                    >
                      <td>
                        <div className="creator-cell">
                          <span className="creator-avatar">{initials(lead.channel_name)}</span>
                          <span className="creator-meta">
                            <strong>{lead.channel_name || "Unnamed channel"}</strong>
                            <small>{lead.data.country || "YouTube creator"} · score {lead.lead_score}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {lead.public_email ? (
                          <a className="email-link" href={`mailto:${encodeURIComponent(lead.public_email.split(",")[0].trim())}`} onClick={(event) => event.stopPropagation()}>
                            {lead.public_email.split(",")[0]}
                          </a>
                        ) : <span className="muted-text">Not listed</span>}
                      </td>
                      <td><span className={`status-badge status-${lead.crm_status}`}>{statusLabels[lead.crm_status]}</span></td>
                      <td>{formatCount(lead.subscriber_count)}</td>
                      <td>{lead.follow_up_date ? formatDate(lead.follow_up_date) : <span className="muted-text">—</span>}</td>
                      <td><button className="row-open" aria-label={`Open ${lead.channel_name}`}>→</button></td>
                    </tr>
                  ))}
                  {!filteredLeads.length && (
                    <tr><td className="empty-row" colSpan={6}>No leads match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>Showing {filteredLeads.length.toLocaleString()} of {leads.length.toLocaleString()} leads</span>
              <span className="secure-label"><span>●</span> Private workspace</span>
            </div>
          </section>
          <p className="footer-note">Use creator-published contact details and respect each creator’s stated preferences.</p>
        </div>
      </section>

      {selectedLead && (
        <LeadDetails
          key={selectedLead.id}
          lead={selectedLead}
          isAdmin={isAdmin}
          profiles={profiles}
          busy={busy}
          feedback={feedback}
          error={error}
          onClose={() => setSelectedId(null)}
          onSave={handleSave}
        />
      )}
    </main>
  );
}

function LeadDetails({
  lead,
  isAdmin,
  profiles,
  busy,
  feedback,
  error,
  onClose,
  onSave,
}: {
  lead: Lead;
  isAdmin: boolean;
  profiles: CrmProfile[];
  busy: boolean;
  feedback: string;
  error: string;
  onClose: () => void;
  onSave: (input: { status: LeadStatus; notes: string; followUpDate: string; assignedTo: string }) => void;
}) {
  const [status, setStatus] = useState<LeadStatus>(lead.crm_status);
  const [notes, setNotes] = useState(lead.notes);
  const [followUpDate, setFollowUpDate] = useState(lead.follow_up_date ?? "");
  const [assignedTo, setAssignedTo] = useState(lead.assigned_to ?? "");
  const data = lead.data;

  return (
    <>
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close lead details" />
      <aside className="lead-drawer" aria-label="Lead details">
        <div className="drawer-top">
          <span className="section-eyebrow">Lead details</span>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="drawer-creator">
          <span className="creator-avatar large-avatar">{initials(lead.channel_name)}</span>
          <div>
            <h2>{lead.channel_name || "Unnamed channel"}</h2>
            <span className="muted-text">Lead score {lead.lead_score} · {formatCount(lead.subscriber_count)} subscribers</span>
          </div>
        </div>
        <a className="channel-link" href={lead.channel_url} target="_blank" rel="noreferrer">
          Open YouTube channel ↗
        </a>

        <div className="detail-block">
          <span className="detail-label">Public contact</span>
          {lead.public_email ? <a href={`mailto:${encodeURIComponent(lead.public_email.split(",")[0].trim())}`}>{lead.public_email}</a> : <span className="muted-text">No public email listed</span>}
          {data.website && <a className="website-link" href={safeHttpUrl(data.website)} target="_blank" rel="noreferrer">{data.website}</a>}
        </div>

        <div className="detail-block">
          <span className="detail-label">Search match</span>
          <p>{data.source_keywords_all || "Keyword not recorded"}</p>
          {data.matched_titles_all && <p className="detail-muted">{data.matched_titles_all}</p>}
        </div>

        <div className="crm-edit">
          <span className="section-eyebrow">CRM activity</span>
          <label htmlFor="lead-status">Status</label>
          <select id="lead-status" value={status} onChange={(event) => setStatus(event.target.value as LeadStatus)}>
            {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>

          <label htmlFor="lead-follow-up">Follow-up date</label>
          <input id="lead-follow-up" type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />

          {isAdmin && (
            <>
              <label htmlFor="lead-assignee">Assigned to</label>
              <select id="lead-assignee" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
                <option value="">Unassigned</option>
                {profiles.filter((profile) => profile.role === "worker").map((profile) => (
                  <option value={profile.id} key={profile.id}>{profile.email}</option>
                ))}
              </select>
            </>
          )}

          <label htmlFor="lead-notes">Team notes</label>
          <textarea
            id="lead-notes"
            rows={5}
            maxLength={10_000}
            placeholder="Add qualification notes or next steps…"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          {error && <p className="form-message error-message">{error}</p>}
          {feedback && <p className="form-message success-message">{feedback}</p>}
          <button
            className="button button-primary full-width"
            disabled={busy}
            onClick={() => onSave({ status, notes, followUpDate, assignedTo })}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
          <p className="privacy-hint">Follow-up reminders appear in this dashboard; no emails are sent automatically.</p>
        </div>
      </aside>
    </>
  );
}

function StatCard({ label, value, icon, detail, accent = false }: { label: string; value: string; icon: string; detail: string; accent?: boolean }) {
  return (
    <article className={`stat-card ${accent ? "stat-card-accent" : ""}`}>
      <div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isClosed(status: LeadStatus) {
  return status === "not_interested" || status === "do_not_contact";
}

function initials(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "C";
}

function hasPublicEmail(lead: Lead) {
  return Boolean(lead.public_email.trim());
}

function formatCount(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "#";
  } catch (error) {
    if (error instanceof TypeError) return "#";
    throw error;
  }
}
