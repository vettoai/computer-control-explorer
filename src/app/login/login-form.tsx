"use client";

import { useSearchParams } from "next/navigation";

// Plain HTML form POSTed to /login, where src/proxy.ts verifies the password and sets
// the auth cookie. No client-side fetch, no API route.
export function LoginForm() {
  const params = useSearchParams();
  const failed = params.get("error") === "1";
  const from = params.get("from") ?? "";

  return (
    <form
      method="post"
      action="/login"
      className="w-full max-w-sm rounded-lg border border-zinc-200 p-6 dark:border-zinc-800"
    >
      <h1 className="text-lg font-semibold tracking-tight">
        Computer Control Dataset Explorer
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        This explorer is password-protected. Enter the shared password to continue.
      </p>
      {from && <input type="hidden" name="from" value={from} />}
      <input
        type="password"
        name="password"
        autoFocus
        required
        placeholder="Password"
        className="mt-4 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400"
      />
      {failed && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          Incorrect password. Try again.
        </p>
      )}
      <button
        type="submit"
        className="mt-4 w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Continue
      </button>
    </form>
  );
}
