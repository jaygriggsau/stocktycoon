import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";

// Placeholders keep `next build` alive without env vars; auth fails loudly
// at runtime until NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET are set.
export const auth = createNeonAuth({
  baseUrl:
    process.env.NEON_AUTH_BASE_URL ??
    "https://missing-neon-auth-base-url.invalid/neondb/auth",
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET ?? "placeholder-secret-at-least-32-characters",
  },
});

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Convenience: current signed-in user or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const { data: session } = await auth.getSession();
    if (!session?.user) return null;
    return {
      id: session.user.id,
      name: session.user.name || session.user.email || "Trader",
      email: session.user.email ?? "",
    };
  } catch {
    return null;
  }
}
