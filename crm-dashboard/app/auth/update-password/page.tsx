import { redirect } from "next/navigation";
import UpdatePasswordForm from "@/components/update-password-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Set password · Creator CRM" };

export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=recovery");
  }

  return <UpdatePasswordForm />;
}
