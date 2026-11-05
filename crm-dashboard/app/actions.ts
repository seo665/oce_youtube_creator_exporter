"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { LeadStatus } from "@/lib/types";

const leadStatuses: LeadStatus[] = [
  "new",
  "contacted",
  "replied",
  "qualified",
  "not_interested",
  "do_not_contact",
];

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Please sign in again.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || profile?.role !== "admin") {
    throw new Error("Administrator access is required.");
  }

  return { supabase, user };
}

export async function saveLead(input: {
  id: string;
  status: string;
  notes: string;
  followUpDate: string;
  assignedTo: string;
}) {
  if (
    !input ||
    typeof input.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id) ||
    typeof input.status !== "string" ||
    typeof input.notes !== "string" ||
    typeof input.followUpDate !== "string" ||
    typeof input.assignedTo !== "string"
  ) {
    throw new Error("Invalid lead update.");
  }

  const { supabase, user } = await requireAdminOrAssignedWorker(input.id);

  const status = leadStatuses.find((value) => value === input.status);
  if (!status) {
    throw new Error("Choose a valid lead status.");
  }
  if (input.notes.length > 10_000) {
    throw new Error("Notes must be 10,000 characters or fewer.");
  }
  if (input.followUpDate) {
    const date = new Date(`${input.followUpDate}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.followUpDate) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.followUpDate
    ) {
      throw new Error("Choose a valid follow-up date.");
    }
  }

  const update: {
    crm_status: LeadStatus;
    notes: string;
    follow_up_date: string | null;
    assigned_to?: string | null;
  } = {
    crm_status: status,
    notes: input.notes,
    follow_up_date: input.followUpDate || null,
  };

  if (user.role === "admin") {
    if (input.assignedTo) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.assignedTo)) {
        throw new Error("Choose a valid worker for assignment.");
      }
      const { data: assignee, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", input.assignedTo)
        .eq("role", "worker")
        .maybeSingle();

      if (error || !assignee) {
        throw new Error("Choose an active worker for assignment.");
      }
    }
    update.assigned_to = input.assignedTo || null;
  }

  const { error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", input.id);

  if (error) {
    throw new Error(`Could not save this lead: ${error.message}`);
  }

  revalidatePath("/");
}

async function requireAdminOrAssignedWorker(leadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Please sign in again.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Your CRM account is not configured.");
  }
  if (profile.role !== "admin" && profile.role !== "worker") {
    throw new Error("Your CRM account does not have access.");
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .maybeSingle();

  if (leadError || !lead) {
    throw new Error("This lead is not available to your account.");
  }

  return { supabase, user: { ...user, role: profile.role as "admin" | "worker" } };
}

export async function inviteWorker(inputEmail: string) {
  if (typeof inputEmail !== "string") {
    throw new Error("Enter a complete email address.");
  }
  const email = inputEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a complete email address.");
  }

  await requireAdmin();
  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("Set NEXT_PUBLIC_APP_URL before sending invitations.");
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appUrl}/auth/callback`,
  });

  if (error) {
    throw new Error(`Could not send the invitation: ${error.message}`);
  }

  revalidatePath("/");
  return `Invitation sent to ${email}.`;
}
