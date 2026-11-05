import { redirect } from "next/navigation";
import Dashboard from "@/components/dashboard";
import type { ScrapeCampaign } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import type { CrmProfile, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <main className="setup-screen">
        <section className="setup-card">
          <span className="eyebrow">Creator CRM · setup needed</span>
          <h1>Connect your private workspace</h1>
          <p>
            Add your Supabase project URL and public anon key to <code>.env.local</code>,
            then follow the setup guide to create the database and admin account.
          </p>
          <p className="setup-guide-note">See <strong>crm-dashboard/README.md</strong> in the project for setup steps.</p>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return (
      <main className="setup-screen">
        <section className="setup-card">
          <span className="eyebrow">Account setup</span>
          <h1>Your account is not enabled yet</h1>
          <p>Ask the workspace administrator to finish setting up your CRM role.</p>
        </section>
      </main>
    );
  }

  const leads: Lead[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("lead_score", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Could not load CRM leads: ${error.message}`);
    }
    leads.push(...((data ?? []) as Lead[]));
    if (!data || data.length < pageSize) {
      break;
    }
  }

  let profiles: CrmProfile[] = [];
  let campaigns: ScrapeCampaign[] = [];
  if (profile.role === "admin") {
    const [{ data: profileData, error: profilesError }, { data: campaignData, error: campaignsError }] = await Promise.all([
      supabase
      .from("profiles")
      .select("id, email, role")
      .order("email"),
      supabase
        .from("scrape_campaigns")
        .select("id, name, keywords, search_types, max_results, status, completed_keywords, unique_leads, new_leads, duplicates, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    if (profilesError) {
      throw new Error(`Could not load workspace users: ${profilesError.message}`);
    }
    if (campaignsError) {
      throw new Error(`Could not load scrape campaigns: ${campaignsError.message}`);
    }
    profiles = (profileData ?? []) as CrmProfile[];
    campaigns = (campaignData ?? []) as ScrapeCampaign[];
  }

  return (
    <Dashboard
      currentUser={{
        id: profile.id,
        email: profile.email,
        role: profile.role as CrmProfile["role"],
      }}
      leads={leads}
      profiles={profiles}
      campaigns={campaigns}
    />
  );
}
