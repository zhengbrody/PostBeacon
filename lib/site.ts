// Small, public site config. Overridable via NEXT_PUBLIC_* env so the repo,
// feedback link, and demo wiring don't need code changes per deployment.

export const REPO_URL =
  process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/zhengbrody/PostBeacon";

// Where "Send feedback" points during beta. Defaults to GitHub issues (no backend
// needed); set NEXT_PUBLIC_FEEDBACK_URL to a form/mailto to collect it elsewhere.
export const FEEDBACK_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_URL || `${REPO_URL}/issues/new`;
