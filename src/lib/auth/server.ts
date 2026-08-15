import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
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
