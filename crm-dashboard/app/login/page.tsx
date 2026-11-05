import LoginForm from "@/components/login-form";

export const metadata = { title: "Sign in · Creator CRM" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const authError =
    params.error === "invite"
      ? "That invitation link could not be verified. Ask your administrator to send another invitation."
      : params.error === "recovery"
        ? "That password reset link could not be verified. Request a new password reset."
        : "";
  return <LoginForm authError={authError} />;
}
