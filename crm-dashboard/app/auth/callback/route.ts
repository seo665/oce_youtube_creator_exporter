import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");
  const isPasswordReset = next === "/auth/update-password";

  if (!code) {
    return NextResponse.redirect(
      new URL(`/login?error=${isPasswordReset ? "recovery" : "invite"}`, request.url),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${isPasswordReset ? "recovery" : "invite"}`, request.url),
    );
  }

  return NextResponse.redirect(new URL(isPasswordReset ? "/auth/update-password" : "/", request.url));
}
