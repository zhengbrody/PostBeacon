// Small, public site config. Overridable via NEXT_PUBLIC_* env so the repo,
// feedback link, and demo wiring don't need code changes per deployment.

const REPO_URL =
  process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/zhengbrody/PostBeacon";

// Where "Send feedback" points during beta. Defaults to GitHub issues (no backend
// needed); set NEXT_PUBLIC_FEEDBACK_URL to a form/mailto to collect it elsewhere.
export const FEEDBACK_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_URL || `${REPO_URL}/issues/new`;

// A monitored privacy mailbox is preferable to the public feedback tracker.
// Keep the GitHub fallback until inbound mail has actually been configured.
export const PRIVACY_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || "";
export const PRIVACY_CONTACT_URL = PRIVACY_EMAIL ? `mailto:${PRIVACY_EMAIL}` : FEEDBACK_URL;
