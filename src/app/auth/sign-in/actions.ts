"use server";

import { auth } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export async function signInWithEmail(
  _prevState: { error: string } | null,
  formData: FormData
): Promise<{ error: string } | null> {
  const { error } = await auth.signIn.email({
    email: (formData.get("email") as string)?.trim(),
    password: formData.get("password") as string,
  });
  if (error) {
    return { error: error.message || "Failed to sign in. Try again." };
  }
  redirect("/portfolio");
}
