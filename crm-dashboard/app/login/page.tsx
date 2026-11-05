import LoginForm from "@/components/login-form";

export const metadata = { title: "Sign in · Creator CRM" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm inviteFailed={params.error === "invite"} />;
}
