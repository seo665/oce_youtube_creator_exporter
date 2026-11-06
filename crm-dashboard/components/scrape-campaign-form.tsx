"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ScrapeCampaign } from "@/lib/types";

type SearchMode = "both" | "channel" | "video";

export default function ScrapeCampaignForm({ campaigns }: { campaigns: ScrapeCampaign[] }) {
  const router = useRouter();
  const today = new Date();
  const [name, setName] = useState(`YouTube campaign · ${today.toLocaleDateString()}`);
  const [keywordsText, setKeywordsText] = useState("");
  const [maxResults, setMaxResults] = useState(25);
  const [searchMode, setSearchMode] = useState<SearchMode>("both");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [suggestionPrompt, setSuggestionPrompt] = useState("");
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [error, setError] = useState("");

  const keywords = useMemo(() => parseKeywords(keywordsText), [keywordsText]);
  const usedKeywords = useMemo(
    () => new Set(campaigns.flatMap((campaign) => campaign.keywords.map(normalizeKeyword))),
    [campaigns],
  );
  const filteredCampaigns = useMemo(() => {
    const query = campaignSearch.trim().toLocaleLowerCase();
    if (!query) return campaigns;
    return campaigns.filter((campaign) =>
      campaign.name.toLocaleLowerCase().includes(query) ||
      campaign.keywords.some((keyword) => keyword.toLocaleLowerCase().includes(query)),
    );
  }, [campaignSearch, campaigns]);
  const repeatedKeywords = keywords.filter((keyword) => usedKeywords.has(normalizeKeyword(keyword)));
  const searchTypes = searchMode === "both" ? ["channel", "video"] : [searchMode];
  const estimatedSearchUnits = keywords.length * searchTypes.length * 100;

  function getKeywordSuggestions() {
    const usedPhrases = [...usedKeywords].sort();
    const prompt = [
      "Suggest exactly 20 fresh YouTube search phrases for finding public channels that discuss OnlyFans creator topics, education, services, tools, or business.",
      "Every phrase must include the exact word OnlyFans, be meaningfully distinct from the other suggestions, and be suitable as a YouTube search query.",
      "Do not repeat or closely paraphrase any phrase in this used-phrase list:",
      usedPhrases.length ? usedPhrases.map((phrase) => `- ${phrase}`).join("\n") : "- No phrases have been used yet.",
      "Return only the 20 phrases, one per line, without numbering or commentary.",
    ].join("\n\n");
    setSuggestionPrompt(prompt);
    setSuggestionMessage("");
    window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
    void navigator.clipboard.writeText(prompt).then(
      () => setSuggestionMessage("Prompt copied. Paste it into the ChatGPT tab, then paste its 20 lines into Search phrases."),
      () => setSuggestionMessage("Automatic copy failed. Copy the prompt from the box below, then paste it into ChatGPT."),
    );
  }

  async function copySuggestionPrompt() {
    try {
      await navigator.clipboard.writeText(suggestionPrompt);
      setSuggestionMessage("Prompt copied. Paste it into ChatGPT, then paste its 20 lines into Search phrases.");
    } catch {
      setSuggestionMessage("Could not copy automatically. Select and copy the prompt from the box below.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!name.trim()) {
      setError("Enter a campaign name.");
      return;
    }
    if (keywords.length < 1 || keywords.length > 30) {
      setError("Add between 1 and 30 distinct search phrases, one per line.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { data: campaignId, error: createError } = await supabase.rpc("create_scrape_campaign", {
        p_name: name.trim(),
        p_keywords: keywords,
        p_search_types: searchTypes,
        p_max_results: maxResults,
      });
      if (createError) throw new Error(createError.message);
      if (typeof campaignId !== "string") throw new Error("Could not create the scrape campaign.");

      await runCampaign(campaignId, keywords, [], supabase);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start this campaign.");
      setBusy(false);
    }
  }

  async function resumeCampaign(campaign: ScrapeCampaign) {
    setError("");
    setMessage("");
    setBusy(true);
    setName(campaign.name);
    setKeywordsText(campaign.keywords.join("\n"));
    setMaxResults(campaign.max_results);
    setSearchMode(campaign.search_types.length === 2 ? "both" : campaign.search_types[0]);
    try {
      await runCampaign(campaign.id, campaign.keywords, campaign.completed_keywords, createClient());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resume this campaign.");
      setBusy(false);
    }
  }

  async function runCampaign(
    campaignId: string,
    allKeywords: string[],
    completedKeywords: string[],
    supabase: ReturnType<typeof createClient>,
  ) {
    const remaining = allKeywords.filter((keyword) => !completedKeywords.includes(keyword));
    let newLeads = 0;
    let duplicates = 0;

    try {
      for (let index = 0; index < remaining.length; index += 1) {
        const keyword = remaining[index];
        setProgress(`Searching phrase ${index + 1} of ${remaining.length}: ${keyword}`);
        const response = await fetch("/api/scrape/keyword", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId, keyword }),
        });
        const result = await response.json() as {
          error?: string;
          newLeads?: number;
          duplicates?: number;
        };
        if (!response.ok) {
          throw new Error(result.error ?? `Search failed with HTTP ${response.status}.`);
        }
        newLeads += result.newLeads ?? 0;
        duplicates += result.duplicates ?? 0;
      }

      const { error: completeError } = await supabase.rpc("complete_scrape_campaign", {
        p_campaign_id: campaignId,
      });
      if (completeError) throw new Error(completeError.message);

      setMessage(`Campaign complete. ${newLeads} new leads added; ${duplicates} matches were flagged as duplicates.`);
      setProgress("");
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "Search failed.";
      setError(`${reason} Completed phrases are saved. Resume this campaign from the list below.`);
      setProgress("");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <section className="campaign-panel" aria-label="YouTube scrape campaign">
      <div className="campaign-heading">
        <div>
          <span className="section-eyebrow">YouTube Data API</span>
          <h2>New scrape campaign</h2>
          <p>Group up to 30 phrases in one campaign. Results are combined into the lead pool and repeats are flagged.</p>
        </div>
      </div>

      <form className="campaign-form" onSubmit={submit}>
        <label>
          Campaign name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={busy} />
        </label>
        <label className="campaign-keywords">
          Search phrases <span>One phrase per line · {keywords.length}/30</span>
          <textarea
            rows={6}
            value={keywordsText}
            onChange={(event) => setKeywordsText(event.target.value)}
            placeholder={"OnlyFans creator tips\nOnlyFans promotion strategies\nCreator subscription business"}
            disabled={busy}
          />
        </label>
        {repeatedKeywords.length > 0 && (
          <p className="campaign-warning">
            Previously used phrases: {repeatedKeywords.join(", ")}. Re-running them can add more duplicate matches.
          </p>
        )}
        <div className="campaign-options">
          <label>
            Search mode
            <select value={searchMode} onChange={(event) => setSearchMode(event.target.value as SearchMode)} disabled={busy}>
              <option value="both">Channels + videos</option>
              <option value="channel">Channels only</option>
              <option value="video">Videos only</option>
            </select>
          </label>
          <label>
            Results per phrase
            <select value={maxResults} onChange={(event) => setMaxResults(Number(event.target.value))} disabled={busy}>
              <option value={10}>10 per search</option>
              <option value={25}>25 per search</option>
            </select>
          </label>
          <button className="button button-primary" type="submit" disabled={busy || keywords.length === 0}>
            {busy ? "Campaign running…" : "Start YouTube scrape"}
          </button>
        </div>
        <p className="campaign-hint">
          Searches run one phrase at a time. Estimated search quota: about {estimatedSearchUnits.toLocaleString()} units
          {searchMode === "both" ? " (channels and videos)" : ""}. Emails are read only from public YouTube channel descriptions.
        </p>
        {progress && <p className="form-message">{progress}</p>}
        {message && <p className="form-message success-message">{message}</p>}
        {error && <p className="form-message error-message">{error}</p>}
      </form>

      <div className="campaign-history">
        <div className="campaign-history-heading">
          <div>
            <h3>Used search phrases</h3>
            <p>{usedKeywords.size} unique phrases across {campaigns.length} campaigns. Previously used phrases are flagged above.</p>
          </div>
          <div className="campaign-history-actions">
            <button className="button button-secondary" type="button" onClick={getKeywordSuggestions} disabled={busy}>
              Suggest 20 fresh keywords
            </button>
            {campaigns.length > 0 && (
              <input
                aria-label="Search campaign names and used phrases"
                type="search"
                value={campaignSearch}
                onChange={(event) => setCampaignSearch(event.target.value)}
                placeholder="Find a used phrase…"
              />
            )}
          </div>
        </div>
        {suggestionMessage && (
          <p className="form-message">{suggestionMessage}</p>
        )}
        {suggestionPrompt && (
          <div className="suggestion-prompt">
            <textarea aria-label="Keyword suggestion prompt to paste into ChatGPT" readOnly rows={5} value={suggestionPrompt} />
            <button className="text-button" type="button" onClick={() => void copySuggestionPrompt()}>
              Copy prompt again
            </button>
          </div>
        )}
        {campaigns.length === 0 ? (
          <p className="muted-text">Campaign names and used phrases will appear here after your first scrape.</p>
        ) : filteredCampaigns.length === 0 ? (
          <p className="muted-text">No campaign or phrase matches that search.</p>
        ) : (
          <ul>
            {filteredCampaigns.map((campaign) => (
              <li key={campaign.id}>
                <div>
                  <strong>{campaign.name}</strong>
                  <span>
                    {campaign.keywords.length} phrases · {campaign.unique_leads} unique leads · {campaign.duplicates} duplicates · {formatDate(campaign.created_at)}
                  </span>
                  <details className="campaign-keyword-list">
                    <summary>{campaign.keywords.length} used {campaign.keywords.length === 1 ? "phrase" : "phrases"}</summary>
                    <ul>
                      {campaign.keywords.map((keyword) => (
                        <li key={normalizeKeyword(keyword)}>{keyword}</li>
                      ))}
                    </ul>
                  </details>
                </div>
                {campaign.status === "running" ? (
                  <button className="text-button" type="button" onClick={() => void resumeCampaign(campaign)} disabled={busy}>
                    Resume ({campaign.completed_keywords.length}/{campaign.keywords.length})
                  </button>
                ) : (
                  <span className="campaign-complete">Complete</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function parseKeywords(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\n,;]+/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => {
      const normalized = normalizeKeyword(keyword);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function normalizeKeyword(keyword: string) {
  return keyword.trim().toLocaleLowerCase();
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}
