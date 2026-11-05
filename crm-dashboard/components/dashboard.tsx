"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveLead } from "@/app/actions";
import InviteWorkerForm from "@/components/invite-worker-form";
import ScrapeCampaignForm from "@/components/scrape-campaign-form";
import { createClient } from "@/lib/supabase/client";
import { mentionsOnlyFansInSearchMatch, type CrmProfile, type Lead, type LeadStatus, type ScrapeCampaign } from "@/lib/types";

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
  campaigns: ScrapeCampaign[];
};

type EmailFilter = "all" | "has_email" | "manual_check";
type DuplicateFilter = "all" | "duplicates" | "new";
type RelevanceFilter = "all" | "mentions_onlyfans" | "needs_review";

export default function Dashboard({ currentUser, leads: initialLeads, profiles, campaigns }: Props) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [duplicateFilter, setDuplicateFilter] = useState<DuplicateFilter>("all");
  const [relevanceFilter, setRelevanceFilter] = useState<RelevanceFilter>("all");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const isAdmin = currentUser.role === "admin";
  const selectedLead = leads.find((lead) => lead.id === selectedId) ?? null;
  const emailCount = leads.filter((lead) => hasPublicEmail(lead)).length;
  const manualCheckCount = leads.length - emailCount;
  const duplicateCount = leads.filter((lead) => lead.scrape_count > 1).length;
  const relevanceReviewCount = leads.filter((lead) => !mentionsOnlyFansInSearchMatch(lead)).length;
  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (statusFilter !== "all" && lead.crm_status !== statusFilter) return false;
      if (emailFilter === "has_email" && !hasPublicEmail(lead)) return false;
      if (emailFilter === "manual_check" && hasPublicEmail(lead)) return false;
      if (duplicateFilter === "duplicates" && lead.scrape_count <= 1) return false;
      if (duplicateFilter === "new" && lead.scrape_count > 1) return false;
      const hasOnlyFansMatch = mentionsOnlyFansInSearchMatch(lead);
      if (relevanceFilter === "mentions_onlyfans" && !hasOnlyFansMatch) return false;
      if (relevanceFilter === "needs_review" && hasOnlyFansMatch) return false;
      if (!query) return true;
      const haystack = [
        lead.channel_name,
        lead.public_email,
        lead.channel_id,
        lead.data.source_keywords_all,
        lead.data.matched_titles_all,
        lead.data.matched_descriptions_all,
        lead.data.channel_description,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [duplicateFilter, emailFilter, leads, relevanceFilter, search, statusFilter]);

  async function handleSave(input: {
    status: LeadStatus;
    notes: string;
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
    const headers = [
      ...sourceColumns,
      "scrape_count",
      "is_duplicate",
      "match_relevance",
      "crm_status",
      "assigned_to",
      "crm_notes",
    ];
    const csvRows = [
      headers,
      ...filteredLeads.map((lead) => [
        ...sourceColumns.map((column) => lead.data[column] ?? ""),
        lead.scrape_count,
        lead.scrape_count > 1 ? "yes" : "no",
        mentionsOnlyFansInSearchMatch(lead) ? "mentions OnlyFans" : "needs relevance review",
        lead.crm_status,
        profiles.find((profile) => profile.id === lead.assigned_to)?.email ??
          (lead.assigned_to === currentUser.id ? currentUser.email : ""),
        lead.notes,
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
    const exportParts = [
      emailFilter === "has_email" ? "public-emails" : emailFilter === "manual_check" ? "manual-email-check" : "",
      relevanceFilter === "needs_review" ? "relevance-review" : relevanceFilter === "mentions_onlyfans" ? "onlyfans-matches" : "",
      duplicateFilter === "duplicates" ? "duplicates" : duplicateFilter === "new" ? "single-campaign" : "",
    ].filter(Boolean);
    link.download = `creator-crm-${exportParts.length ? exportParts.join("-") : "leads"}.csv`;
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

        <div className="sidebar-bottom">
          {isAdmin && (
            <>
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
          <div className="run-chip"><i /> YouTube campaign workspace</div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <span className="eyebrow">OnlyFans creator search</span>
              <h1>Leads</h1>
              <p>Run grouped YouTube searches, review public email coverage, spot repeat creators, and triage uncertain matches.</p>
            </div>
            <button className="button button-secondary export-button" onClick={exportLeads} disabled={!filteredLeads.length}>
              <span>↓</span> Export CSV
            </button>
          </section>

          <section className="stats-grid" aria-label="Lead summary">
            <StatCard label="Total leads" value={leads.length.toLocaleString()} icon="▦" detail="Combined across campaigns" />
            <StatCard label="Public emails" value={emailCount.toLocaleString()} icon="✉" detail="Listed publicly by creators" />
            <StatCard label="Manual email check" value={manualCheckCount.toLocaleString()} icon="⌕" detail="No public email listed" />
            <StatCard label="Repeat creators" value={duplicateCount.toLocaleString()} icon="↻" detail="Found in multiple campaigns" accent={duplicateCount > 0} />
            <StatCard label="Relevance review" value={relevanceReviewCount.toLocaleString()} icon="?" detail="Matched result lacks “OnlyFans”" accent={relevanceReviewCount > 0} />
          </section>

          {isAdmin && <ScrapeCampaignForm campaigns={campaigns} />}

          <section className="lead-panel" id="leads">
            <div className="panel-heading">
              <div>
                <h2>Creator leads <span className="heading-count">{filteredLeads.length}</span></h2>
                <p>Filter by public email, repeat campaigns, and whether matched YouTube results mention “OnlyFans.”</p>
              </div>
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
                <span>Relevance</span>
                <select value={relevanceFilter} onChange={(event) => setRelevanceFilter(event.target.value as RelevanceFilter)}>
                  <option value="all">All matches</option>
                  <option value="mentions_onlyfans">Mentions OnlyFans ({(leads.length - relevanceReviewCount).toLocaleString()})</option>
                  <option value="needs_review">Needs review ({relevanceReviewCount.toLocaleString()})</option>
                </select>
              </label>
              <label className="filter-select">
                <span>Status</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              <label className="filter-select">
                <span>Campaigns</span>
                <select value={duplicateFilter} onChange={(event) => setDuplicateFilter(event.target.value as DuplicateFilter)}>
                  <option value="all">All creators</option>
                  <option value="duplicates">Repeat creators ({duplicateCount.toLocaleString()})</option>
                  <option value="new">Single campaign only</option>
                </select>
              </label>
            </div>

            {error && <p className="inline-alert error-message">{error}</p>}
            <div className="table-scroll">
              <table className="leads-table">
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Public email</th>
                    <th>Match</th>
                    <th>Status</th>
                    <th>Subscribers</th>
                    <th>Campaigns</th>
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
                            <small>
                              {lead.data.country || "YouTube creator"} · score {lead.lead_score}
                              {lead.scrape_count > 1 && <span className="duplicate-badge">Repeat ×{lead.scrape_count}</span>}
                            </small>
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
                      <td>
                        <span className={`relevance-badge ${mentionsOnlyFansInSearchMatch(lead) ? "relevance-match" : "relevance-review"}`}>
                          {mentionsOnlyFansInSearchMatch(lead) ? "OnlyFans match" : "Review"}
                        </span>
                      </td>
                      <td><span className={`status-badge status-${lead.crm_status}`}>{statusLabels[lead.crm_status]}</span></td>
                      <td>{formatCount(lead.subscriber_count)}</td>
                      <td>{lead.scrape_count > 1 ? `${lead.scrape_count} campaigns` : "1 campaign"}</td>
                      <td><button className="row-open" aria-label={`Open ${lead.channel_name}`}>→</button></td>
                    </tr>
                  ))}
                  {!filteredLeads.length && (
                    <tr><td className="empty-row" colSpan={7}>No leads match these filters.</td></tr>
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
  onSave: (input: { status: LeadStatus; notes: string; assignedTo: string }) => void;
}) {
  const [status, setStatus] = useState<LeadStatus>(lead.crm_status);
  const [notes, setNotes] = useState(lead.notes);
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
          <span className={`relevance-badge ${mentionsOnlyFansInSearchMatch(lead) ? "relevance-match" : "relevance-review"}`}>
            {mentionsOnlyFansInSearchMatch(lead)
              ? "Matched content mentions OnlyFans"
              : "Needs relevance review: matched content does not mention OnlyFans"}
          </span>
          {data.matched_titles_all && <p className="detail-muted">{data.matched_titles_all}</p>}
          {data.matched_descriptions_all && <p className="detail-muted">{data.matched_descriptions_all}</p>}
        </div>

        <div className="crm-edit">
          <span className="section-eyebrow">CRM activity</span>
          <label htmlFor="lead-status">Status</label>
          <select id="lead-status" value={status} onChange={(event) => setStatus(event.target.value as LeadStatus)}>
            {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>

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
            onClick={() => onSave({ status, notes, assignedTo })}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
          <p className="privacy-hint">Email verification and outreach are handled outside this workspace.</p>
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

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "#";
  } catch (error) {
    if (error instanceof TypeError) return "#";
    throw error;
  }
}
