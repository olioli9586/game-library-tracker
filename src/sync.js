const TOKEN_KEY = "game_sync_token_v1";
const GIST_KEY = "game_sync_gist_id_v1";
const LAST_KEY = "game_sync_last_v1";
const SEEN_KEY = "game_sync_seen_v1"; // exportedAt of the cloud copy this device last pushed or pulled
const GIST_FILE = "game_vault.json";
const API = "https://api.github.com";

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const getGistId = () => localStorage.getItem(GIST_KEY) || "";
export const getLastSync = () => localStorage.getItem(LAST_KEY) || "";
export const isConfigured = () => !!getToken() && !!getGistId();

export function saveCreds(token, gistId) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(GIST_KEY, gistId);
}
export function clearCreds() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(GIST_KEY);
  localStorage.removeItem(LAST_KEY);
  localStorage.removeItem(SEEN_KEY);
}
export function setLastSync(iso) {
  localStorage.setItem(LAST_KEY, iso);
}
export const getSeen = () => localStorage.getItem(SEEN_KEY) || "";
export function setSeen(iso) {
  if (iso) localStorage.setItem(SEEN_KEY, iso);
}

async function gh(path, options = {}, token = getToken()) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.message ?? ""; } catch {}
    throw new Error(`GitHub ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

export async function validateToken(token) {
  return gh("/user", {}, token);
}

export function buildPayload(games, subs) {
  return {
    schema: 1,
    exportedAt: new Date().toISOString(),
    games,
    subscriptions: subs,
  };
}

function parseContent(gist) {
  const file = gist.files?.[GIST_FILE];
  if (!file?.content) return null;
  try {
    const data = JSON.parse(file.content);
    if (!Array.isArray(data.games)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function pull() {
  const gistId = getGistId();
  if (!gistId) throw new Error("No gist configured");
  const gist = await gh(`/gists/${gistId}`);
  const data = parseContent(gist);
  if (data?.exportedAt) setSeen(data.exportedAt);
  return { data, updatedAt: gist.updated_at };
}

export async function push(games, subs, { force = false } = {}) {
  const gistId = getGistId();
  if (!gistId) throw new Error("No gist configured");
  if (!force) {
    // Safety check: refuse to overwrite a cloud copy this device has never seen
    // (i.e. another device pushed since our last pull/push).
    const gist = await gh(`/gists/${gistId}`);
    const remote = parseContent(gist);
    const seen = getSeen();
    if (remote?.exportedAt && seen && remote.exportedAt !== seen) {
      return { conflict: true, remote };
    }
  }
  const payload = buildPayload(games, subs);
  await gh(`/gists/${gistId}`, {
    method: "PATCH",
    body: JSON.stringify({
      files: { [GIST_FILE]: { content: JSON.stringify(payload, null, 2) } },
    }),
  });
  setLastSync(new Date().toISOString());
  setSeen(payload.exportedAt);
  return { conflict: false, payload };
}

export async function createGist(token, games, subs) {
  const payload = buildPayload(games, subs);
  const gist = await gh(
    "/gists",
    {
      method: "POST",
      body: JSON.stringify({
        description: "Game Vault library (synced)",
        public: false,
        files: { [GIST_FILE]: { content: JSON.stringify(payload, null, 2) } },
      }),
    },
    token
  );
  setSeen(payload.exportedAt);
  return gist.id;
}

export function maskToken(t) {
  if (!t) return "";
  if (t.length <= 8) return "•".repeat(t.length);
  return t.slice(0, 4) + "•".repeat(Math.max(0, t.length - 8)) + t.slice(-4);
}

export function relativeTime(iso) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
