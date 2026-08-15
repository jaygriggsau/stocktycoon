import Link from "next/link";
import { getSessionUser } from "@/lib/auth/server";
import { SignOutButton } from "./SignOutButton";

export async function Nav() {
  const user = await getSessionUser();
  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Stock<span className="text-accent">Tycoon</span>
        </Link>
        <nav className="flex flex-1 items-center gap-4 text-sm text-ink-muted">
          <Link href="/market" className="hover:text-ink">Market</Link>
          <Link href="/news" className="hover:text-ink">News</Link>
          <Link href="/leaderboard" className="hover:text-ink">Leaderboard</Link>
          {user && <Link href="/portfolio" className="hover:text-ink">Portfolio</Link>}
        </nav>
        {user ? (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">{user.name}</span>
            <SignOutButton />
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <Link href="/auth/sign-in" className="text-ink-muted hover:text-ink">Sign in</Link>
            <Link
              href="/auth/sign-up"
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-surface hover:opacity-90"
            >
              Play free
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
