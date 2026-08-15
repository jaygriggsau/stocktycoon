"use server";

import { auth } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export async function signUpWithEmail(
  _prevState: { error: string } | null,
  formData: FormData
): Promise<{ error: string } | null> {
  const email = (formData.get("email") as string)?.trim();
  const name = (formData.get("name") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !name || !password) {
    return { error: "Name, email and password are required." };
  }

  const { error } = await auth.signUp.email({ email, name, password });
  if (error) {
    return { error: error.message || "Failed to create account" };
  }
  redirect("/portfolio");
}
