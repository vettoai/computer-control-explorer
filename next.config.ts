import type { NextConfig } from "next";

// Build target is chosen by EXPLORER_MODE:
//   export   -> static HTML in out/ (the shippable, no-runtime bundle)
//   default  -> standalone server (Docker / local-dir, reads DATASET_DIR at runtime)
// The data layer (filesystem reads in Server Components) is identical either way;
// only when the read happens (build time vs request time) differs. See PLAN.md / AGENTS.md.
const isExport = process.env.EXPLORER_MODE === "export";

const nextConfig: NextConfig = {
  output: isExport ? "export" : "standalone",
  // Static export can't use the runtime Image Optimization API; the explorer is
  // text/data-driven, so disabling it everywhere keeps both targets identical.
  images: { unoptimized: true },
  // For the export, emit every route as <route>/index.html. This serves correctly on
  // any dumb static file server (no .html-extension rewrite needed) and avoids the
  // task page (task/<slug>.html) colliding with the trial dir (task/<slug>/t/...).
  trailingSlash: isExport,
};

export default nextConfig;
