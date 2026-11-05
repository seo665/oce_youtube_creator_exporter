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
  crm_status: LeadStatus;
  assigned_to: string | null;
  notes: string;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmProfile = {
  id: string;
  email: string;
  role: "admin" | "worker";
};
