import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in · Computer Control Dataset Explorer",
};

// Rendered only when EXPLORER_PASSWORD is set: src/proxy.ts redirects unauthenticated
// requests here and handles the form POST. The page itself is fully static (the export
// build emits it too, where it's inert dead weight since the export has no proxy).
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
