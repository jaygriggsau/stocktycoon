"use client";

import Link from "next/link";
import { useActionState } from "react";

type Action = (
  prevState: { error: string } | null,
  formData: FormData
) => Promise<{ error: string } | null>;

export function AuthForm({ mode, action }: { mode: "sign-in" | "sign-up"; action: Action }) {
  const [state, formAction, isPending] = useActionState(action, null);
  const isSignUp = mode === "sign-up";

  const field =
    "block w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-lg border border-edge bg-panel p-6">
      <h1 className="mb-1 text-xl font-bold">{isSignUp ? "Create your account" : "Welcome back"}</h1>
      <p className="mb-5 text-sm text-ink-muted">
        {isSignUp ? "Start trading with $100,000 in simulated cash." : "Sign in to manage your portfolio."}
      </p>
      <form action={formAction} className="space-y-4">
        {isSignUp && (
          <div>
            <label htmlFor="name" className="mb-1 block text-xs text-ink-muted">Display name</label>
            <input id="name" name="name" type="text" required placeholder="Warren B." className={field} />
          </div>
        )}
        <div>
          <label htmlFor="email" className="mb-1 block text-xs text-ink-muted">Email</label>
          <input id="email" name="email" type="email" required placeholder="you@example.com" className={field} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs text-ink-muted">Password</label>
          <input id="password" name="password" type="password" required minLength={8} placeholder="••••••••" className={field} />
        </div>
        {state?.error && <p className="text-sm text-loss" role="alert">{state.error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-accent py-2 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Working..." : isSignUp ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-ink-muted">
        {isSignUp ? (
          <>Already playing? <Link href="/auth/sign-in" className="text-accent">Sign in</Link></>
        ) : (
          <>New here? <Link href="/auth/sign-up" className="text-accent">Create an account</Link></>
        )}
      </p>
    </div>
  );
}
