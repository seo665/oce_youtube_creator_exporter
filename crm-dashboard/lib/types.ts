export type LeadStatus =
  | "new"
  | "contacted"
  | "replied"
  | "qualified"
  | "not_interested"
  | "do_not_contact";

export type Lead = {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_url: string;
  public_email: string;
  subscriber_count: number | null;
  lead_score: number;
  data: Record<string, string>;
  scrape_count: number;
  first_seen_at: string;
  last_seen_at: string;
  crm_status: LeadStatus;
  assigned_to: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

export function mentionsOnlyFansInSearchMatch(lead: Lead) {
  const matchedContent = [
    lead.data.matched_titles_all,
    lead.data.matched_descriptions_all,
  ]
    .filter(Boolean)
    .join(" ");
  return /\bonlyfans\b/i.test(matchedContent);
}

export type CrmProfile = {
  id: string;
  email: string;
  role: "admin" | "worker";
};

export type ScrapeCampaign = {
  id: string;
  name: string;
  keywords: string[];
  search_types: ("channel" | "video")[];
  max_results: number;
  status: "running" | "complete";
  completed_keywords: string[];
  unique_leads: number;
  new_leads: number;
  duplicates: number;
  created_at: string;
};
