import { store } from "../../app/store";
import { clearAuth } from "../auth/authSlice";

const SESSION_KEY = "interview-online:team-invitation";
const AUTH_RETURN_KEY = "interview-online:team-invitation-auth-return";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

if (
  window.location.pathname === "/login"
  && sessionStorage.getItem(AUTH_RETURN_KEY) === "1"
  && TOKEN_PATTERN.test(sessionStorage.getItem(SESSION_KEY) ?? "")
) {
  store.dispatch(clearAuth());
}

function ensureNoReferrer() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "referrer";
    document.head.prepend(meta);
  }
  meta.content = "no-referrer";
}

export function captureTeamInvitationFragment() {
  if (window.location.pathname !== "/join/team") return;
  ensureNoReferrer();
  const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
  if (match?.[1] && TOKEN_PATTERN.test(match[1])) {
    sessionStorage.setItem(SESSION_KEY, match[1]);
  }
  if (window.location.hash) {
    const scrubbedPath = match?.[1]
      ? `/join/team/pending${window.location.search}`
      : `${window.location.pathname}${window.location.search}`;
    history.replaceState(history.state, "", scrubbedPath);
  }
}

export function currentTeamInvitationToken(): string | null {
  const stored = sessionStorage.getItem(SESSION_KEY);
  return stored && TOKEN_PATTERN.test(stored) ? stored : null;
}

export function preserveTeamInvitationForLogin(): boolean {
  if (!currentTeamInvitationToken()) return false;
  sessionStorage.setItem(AUTH_RETURN_KEY, "1");
  return true;
}

export function clearTeamInvitationToken() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(AUTH_RETURN_KEY);
}
