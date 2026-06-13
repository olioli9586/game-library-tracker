import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as sync from "./sync.js";

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                  */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "game_library_v2";
const SUBS_KEY = "game_subscriptions_v1";

const PLATFORMS = ["NS1", "NS2", "PS4", "PS5", "Steam", "Epic", "GOG", "Prime"];

const PLATFORM_COLORS = {
  NS1: "#E60012",
  NS2: "#8B0000",
  PS4: "#003088",
  PS5: "#003088",
  Steam: "#1B2838",
  Epic: "#3D3D3D",
  GOG: "#5C2D8F",
  Prime: "#cc7a00",
};

const SOURCES = {
  purchased: { label: "Purchased", permanent: true },
  physical: { label: "Physical", permanent: true },
  free: { label: "Free / Giveaway", permanent: true },
  epic_free: { label: "Epic Free", permanent: true },
  prime_gaming: { label: "Prime Gaming (Claimed)", permanent: true },
  ps_plus_monthly: { label: "PS Plus Monthly", permanent: false },
  ps_plus_catalog: { label: "PS Plus Catalog", permanent: false },
  prime_gaming_catalog: { label: "Prime Collection", permanent: false },
  nintendo_online: { label: "Nintendo Online", permanent: false },
  game_pass: { label: "Game Pass", permanent: false },
};

const STATUSES = {
  wishlist: { label: "Wishlist", cls: "bg-dusk/10 text-dusk border-dusk/30" },
  backlog: { label: "Backlog", cls: "bg-fade/10 text-fade border-fade/30" },
  playing: { label: "Playing", cls: "bg-pine/10 text-pine border-pine/30" },
  completed: { label: "Completed", cls: "bg-sage/10 text-sage border-sage/30" },
  dropped: { label: "Dropped", cls: "bg-clay/10 text-clay border-clay/30" },
  on_hold: { label: "On Hold", cls: "bg-honey/10 text-honey border-honey/30" },
};

const SUB_SOURCES = ["ps_plus_monthly", "ps_plus_catalog", "prime_gaming_catalog", "nintendo_online", "game_pass"];
const isSubDependent = (g) => SUB_SOURCES.includes(g.source);

const todayISO = () => new Date().toISOString().slice(0, 10);
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9一-鿿]/g, "");
const fuzzyMatch = (a, b) => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
};

function sourcesForPlatform(platform, current) {
  let list;
  switch (platform) {
    case "NS1":
    case "NS2":
      list = ["purchased", "physical", "free", "nintendo_online"];
      break;
    case "PS4":
    case "PS5":
      list = ["purchased", "physical", "free", "ps_plus_monthly", "ps_plus_catalog"];
      break;
    case "Steam":
      list = ["purchased", "free", "prime_gaming", "game_pass"];
      break;
    case "Epic":
      list = ["purchased", "epic_free", "free", "prime_gaming"];
      break;
    case "GOG":
      list = ["purchased", "free", "prime_gaming"];
      break;
    case "Prime":
      list = ["prime_gaming", "prime_gaming_catalog", "free"];
      break;
    default:
      list = Object.keys(SOURCES);
  }
  if (current && !list.includes(current)) list = [current, ...list];
  return list;
}

const SAMPLE_DATA = [
  { id: "a1b2c3d4-0001", title: "The Legend of Zelda: Tears of the Kingdom", platform: "NS1", source: "purchased", status: "completed", rating: 10, hoursPlayed: 87, notes: "", dateAdded: "2023-05-12", completedDate: "2023-08-01" },
  { id: "a1b2c3d4-0002", title: "Hollow Knight", platform: "NS1", source: "purchased", status: "on_hold", rating: 8, hoursPlayed: 12, dateAdded: "2024-01-05" },
  { id: "a1b2c3d4-0003", title: "God of War Ragnarok", platform: "PS5", source: "ps_plus_monthly", status: "backlog", dateAdded: "2024-03-01" },
  { id: "a1b2c3d4-0004", title: "Death Stranding", platform: "PS5", source: "ps_plus_catalog", status: "playing", hoursPlayed: 6, leavingSoon: true, dateAdded: "2024-11-15" },
  { id: "a1b2c3d4-0005", title: "Cyberpunk 2077", platform: "Steam", source: "purchased", status: "completed", rating: 9, hoursPlayed: 110, dateAdded: "2022-08-20", completedDate: "2023-01-15" },
  { id: "a1b2c3d4-0006", title: "Control", platform: "GOG", source: "prime_gaming", status: "backlog", notes: "Claimed via Prime Gaming, redeemed on GOG", dateAdded: "2024-02-14" },
  { id: "a1b2c3d4-0007", title: "Dead Island 2", platform: "Prime", source: "prime_gaming_catalog", status: "backlog", leavingSoon: false, notes: "Available via Prime Gaming Collection in Amazon Games app", dateAdded: "2025-01-10" },
  { id: "a1b2c3d4-0008", title: "Mario Kart World", platform: "NS2", source: "purchased", status: "playing", hoursPlayed: 14, rating: 9, dateAdded: "2025-06-05" },
];

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const csvEscape = (v) => {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function daysBetween(endISO) {
  const end = new Date(endISO + "T23:59:59");
  const now = new Date();
  return Math.floor((end - now) / (1000 * 60 * 60 * 24));
}

function addMonths(isoDate, months) {
  const base = new Date(isoDate + "T12:00:00");
  if (Number.isNaN(base.getTime())) return isoDate;
  const start = base < new Date() ? new Date() : base;
  const next = new Date(start);
  next.setMonth(next.getMonth() + months);
  return next.toISOString().slice(0, 10);
}

const SAMPLE_SUBS = [
  { id: "sub-sample-1", name: "PS Plus Extra", endDate: new Date(Date.now() + 42 * 86400000).toISOString().slice(0, 10), notes: "" },
];

function sanitizeSub(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.name || !raw.endDate) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    name: String(raw.name),
    endDate: String(raw.endDate).slice(0, 10),
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

function sanitizeGame(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.title || !PLATFORMS.includes(raw.platform) || !SOURCES[raw.source] || !STATUSES[raw.status]) return null;
  const g = {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    title: String(raw.title),
    platform: raw.platform,
    source: raw.source,
    status: raw.status,
    dateAdded: typeof raw.dateAdded === "string" && raw.dateAdded ? raw.dateAdded : todayISO(),
  };
  if (typeof raw.rating === "number" && raw.rating >= 1 && raw.rating <= 10) g.rating = raw.rating;
  if (typeof raw.hoursPlayed === "number" && raw.hoursPlayed >= 0) g.hoursPlayed = raw.hoursPlayed;
  if (typeof raw.notes === "string" && raw.notes) g.notes = raw.notes;
  if (typeof raw.completedDate === "string" && raw.completedDate) g.completedDate = raw.completedDate;
  if (raw.leavingSoon === true && isSubDependent(g)) g.leavingSoon = true;
  return g;
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                          */
/* ------------------------------------------------------------------ */

function PlatformBadge({ platform }) {
  return (
    <span
      className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full text-cream border border-black/10 whitespace-nowrap"
      style={{ backgroundColor: PLATFORM_COLORS[platform] }}
    >
      {platform}
    </span>
  );
}

function SourceBadge({ source, leavingSoon }) {
  const meta = SOURCES[source];
  const sub = SUB_SOURCES.includes(source);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${
          sub ? "bg-honey/10 text-honey border-honey/40" : "bg-sage/10 text-sage border-sage/30"
        }`}
      >
        {meta?.label ?? source}
      </span>
      {leavingSoon && (
        <span
          title="Leaving soon"
          className="inline-flex items-center justify-center text-xs font-bold w-5 h-5 rounded-full bg-clay/15 text-clay border border-clay/50"
        >
          !
        </span>
      )}
    </span>
  );
}

function StatusBadge({ status }) {
  const meta = STATUSES[status];
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function IconButton({ onClick, title, children, danger }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg transition-colors text-sm leading-none ${
        danger ? "text-clay hover:bg-clay/10" : "text-fade hover:bg-line/60 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function QuickActionButton({ onClick, children, tone = "wood" }) {
  const tones = {
    wood: "bg-wood/10 text-wood border-wood/40 hover:bg-wood/20",
    amber: "bg-honey/10 text-honey border-honey/40 hover:bg-honey/20",
    red: "bg-clay/10 text-clay border-clay/40 hover:bg-clay/20",
  };
  return (
    <button
      onClick={onClick}
      className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function Modal({ onClose, children, wide }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-ink/40 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`anim-pop w-full ${wide ? "max-w-2xl" : "max-w-lg"} bg-cream border border-line rounded-2xl shadow-2xl shadow-wood-dark/30 my-6`}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add / Edit modal                                                     */
/* ------------------------------------------------------------------ */

function AddEditModal({ game, games, onSave, onClose }) {
  const editing = !!game;
  const [title, setTitle] = useState(game?.title ?? "");
  const [platform, setPlatform] = useState(game?.platform ?? "Steam");
  const [source, setSource] = useState(game?.source ?? "purchased");
  const [status, setStatus] = useState(game?.status ?? "backlog");
  const [rating, setRating] = useState(game?.rating?.toString() ?? "");
  const [notes, setNotes] = useState(game?.notes ?? "");
  const [leavingSoon, setLeavingSoon] = useState(game?.leavingSoon ?? false);
  const [error, setError] = useState("");
  const titleRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const sourceOptions = sourcesForPlatform(platform, editing ? game.source : null);
  useEffect(() => {
    if (!sourceOptions.includes(source)) setSource(sourceOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  const subDep = SUB_SOURCES.includes(source);

  const duplicates = useMemo(() => {
    if (!title.trim()) return [];
    return games.filter((g) => g.id !== game?.id && fuzzyMatch(g.title, title.trim()));
  }, [title, games, game]);

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const ratingNum = rating === "" ? undefined : Math.min(10, Math.max(1, Number(rating)));
    const next = {
      id: game?.id ?? crypto.randomUUID(),
      title: title.trim(),
      platform,
      source,
      status,
      dateAdded: game?.dateAdded ?? todayISO(),
    };
    if (ratingNum !== undefined && !Number.isNaN(ratingNum)) next.rating = ratingNum;
    if (game?.hoursPlayed !== undefined) next.hoursPlayed = game.hoursPlayed;
    if (notes.trim()) next.notes = notes.trim();
    if (subDep && leavingSoon) next.leavingSoon = true;
    if (status === "completed") next.completedDate = game?.completedDate ?? todayISO();
    onSave(next);
  };

  const field = "w-full bg-cream border border-line rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-wood focus:ring-1 focus:ring-wood/40";
  const label = "block text-xs font-bold text-fade uppercase tracking-wider mb-1.5";

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="p-5 sm:p-6">
        <h2 className="font-display text-2xl font-semibold text-ink mb-5">
          {editing ? "Edit Game" : "Add Game"}
        </h2>

        <div className="space-y-4">
          <div>
            <label className={label}>Title *</label>
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} className={field} placeholder="e.g. Elden Ring" />
            {duplicates.length > 0 && (
              <div className="mt-2 text-xs text-honey bg-honey/10 border border-honey/30 rounded-lg px-3 py-2 space-y-0.5">
                {duplicates.slice(0, 3).map((d) => (
                  <div key={d.id}>
                    Possible duplicate: <strong>{d.title}</strong> on {d.platform} ({SOURCES[d.source].label})
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Platform *</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={field}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Source *</label>
              <select value={source} onChange={(e) => setSource(e.target.value)} className={field}>
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>{SOURCES[s].label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Status *</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
                {Object.entries(STATUSES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Rating (1–10)</label>
              <input type="number" min="1" max="10" value={rating} onChange={(e) => setRating(e.target.value)} className={field} placeholder="—" />
            </div>
          </div>

          {subDep && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none bg-honey/5 border border-honey/25 rounded-lg px-3 py-2.5">
              <input type="checkbox" checked={leavingSoon} onChange={(e) => setLeavingSoon(e.target.checked)} className="accent-[#9c6b1f] w-4 h-4" />
              <span className="text-sm text-honey">Leaving soon (removal announced)</span>
            </label>
          )}

          <div>
            <label className={label}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={field} placeholder="e.g. Redeemed on GOG via Prime Gaming" />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-clay">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-fade hover:bg-line/50 hover:text-ink transition-colors">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-semibold bg-wood hover:bg-wood-dark text-cream transition-colors">
            {editing ? "Save Changes" : "Add Game"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Export / Import panel                                                */
/* ------------------------------------------------------------------ */

function CloudSyncPanel({ games, subs, syncState, setSyncState, onPulled, toast }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [token, setToken] = useState("");
  const [gistId, setGistId] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = sync.isConfigured();

  const handleConnect = async () => {
    if (!token.trim()) { toast("Paste a token first.", "error"); return; }
    setBusy(true);
    try {
      await sync.validateToken(token.trim());
      let id = gistId.trim();
      if (!id) {
        id = await sync.createGist(token.trim(), games, subs);
        toast("New private gist created — your library is now in the cloud.", "success");
      } else {
        toast("Connected to existing gist.", "success");
      }
      sync.saveCreds(token.trim(), id);
      setToken(""); setGistId(""); setSetupOpen(false);
      setSyncState({ state: "ok", at: new Date().toISOString() });
      // If a gist ID was provided, pull from it
      if (gistId.trim()) {
        const { data } = await sync.pull();
        if (data) onPulled(data);
      }
    } catch (e) {
      toast(`Connect failed: ${e.message}`, "error");
    } finally { setBusy(false); }
  };

  const handlePush = async () => {
    setBusy(true); setSyncState({ state: "syncing" });
    try {
      await sync.push(games, subs);
      setSyncState({ state: "ok", at: new Date().toISOString() });
      toast("Pushed to cloud.", "success");
    } catch (e) {
      setSyncState({ state: "error", message: e.message });
      toast(`Push failed: ${e.message}`, "error");
    } finally { setBusy(false); }
  };

  const handlePull = async () => {
    setBusy(true); setSyncState({ state: "syncing" });
    try {
      const { data } = await sync.pull();
      if (!data) { toast("Cloud gist is empty or unreadable.", "error"); return; }
      onPulled(data);
      sync.setLastSync(new Date().toISOString());
      setSyncState({ state: "ok", at: new Date().toISOString() });
      toast(`Pulled ${data.games.length} games from cloud.`, "success");
    } catch (e) {
      setSyncState({ state: "error", message: e.message });
      toast(`Pull failed: ${e.message}`, "error");
    } finally { setBusy(false); }
  };

  const handleDisconnect = () => {
    if (!confirm("Disconnect cloud sync? Your library stays on this device; the cloud gist is untouched.")) return;
    sync.clearCreds();
    setSyncState({ state: "off" });
    toast("Disconnected.", "success");
  };

  const statusDot = {
    off: "bg-faint",
    ok: "bg-sage",
    syncing: "bg-honey animate-pulse",
    error: "bg-clay",
  }[syncState.state] || "bg-faint";

  const statusLabel = configured
    ? syncState.state === "syncing" ? "Syncing…"
      : syncState.state === "error" ? `Error · ${syncState.message ?? ""}`
      : syncState.at ? `Synced ${sync.relativeTime(syncState.at)}`
      : "Connected · not synced yet"
    : "Not connected";

  return (
    <div className="bg-card border border-line rounded-2xl p-4 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${statusDot}`}></span>
          <span className="font-display font-semibold text-ink text-base">Cloud Sync</span>
          <span className="text-xs text-fade">via private GitHub Gist</span>
        </div>
        <span className="text-xs text-fade font-mono">{statusLabel}</span>
      </div>

      {configured ? (
        <div className="space-y-3 pt-2 border-t border-line">
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={handlePull} disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-wood/10 text-wood border border-wood/40 hover:bg-wood/20 disabled:opacity-40">
              ↓ Pull from cloud
            </button>
            <button onClick={handlePush} disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-wood/10 text-wood border border-wood/40 hover:bg-wood/20 disabled:opacity-40">
              ↑ Push now
            </button>
            <button onClick={handleDisconnect} disabled={busy} className="ml-auto text-xs font-semibold text-clay hover:underline">
              Disconnect
            </button>
          </div>
          <div className="bg-cream border border-line rounded-lg p-3 space-y-2">
            <div className="text-xs font-bold text-fade uppercase tracking-wider">Use this on your other devices</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-ink bg-paper border border-line rounded px-2.5 py-1.5 break-all select-all">
                {sync.getGistId()}
              </code>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(sync.getGistId());
                    toast("Gist ID copied — paste it on your other device.", "success");
                  } catch {
                    toast("Couldn't copy automatically — long-press the ID and copy.", "error");
                  }
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-wood hover:bg-wood-dark text-cream whitespace-nowrap"
              >
                Copy ID
              </button>
            </div>
            <p className="text-xs text-faint">
              On your phone: open this app → Export / Import → Set up sync → paste the same token + this gist ID.
            </p>
            <a
              href={`https://gist.github.com/${sync.getGistId()}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-block text-xs text-wood hover:text-wood-dark underline"
            >
              View gist on GitHub →
            </a>
          </div>
        </div>
      ) : !setupOpen ? (
        <button onClick={() => setSetupOpen(true)} className="w-full mt-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-wood hover:bg-wood-dark text-cream transition-colors">
          Set up sync across devices
        </button>
      ) : (
        <div className="space-y-3 pt-2 border-t border-line">
          <div className="text-xs text-fade leading-relaxed bg-honey/10 border border-honey/30 rounded-lg p-3">
            <strong className="text-honey">Important:</strong> Don't paste this token anywhere except here. It only goes to GitHub's API from your browser.<br/>
            <strong className="text-ink mt-1 block">How to get one (60 seconds):</strong>
            <ol className="list-decimal ml-5 mt-1 space-y-0.5 text-ink/80">
              <li>Open <a href="https://github.com/settings/tokens/new?description=Game%20Vault%20sync&scopes=gist" target="_blank" rel="noopener noreferrer" className="text-wood underline font-mono break-all">github.com/settings/tokens/new</a></li>
              <li>Note: "Game Vault sync" · Expiration: No expiration (or 1 year)</li>
              <li>Scope: check <strong>gist</strong> only — nothing else</li>
              <li>Generate token → copy it (starts with <code className="font-mono">ghp_</code>) → paste below</li>
            </ol>
          </div>
          <div>
            <label className="block text-xs font-bold text-fade uppercase tracking-wider mb-1.5">GitHub Personal Access Token *</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-cream border border-line rounded-lg px-3 py-2 text-ink text-sm font-mono focus:outline-none focus:border-wood"
              autoComplete="off"
              spellCheck="false"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-fade uppercase tracking-wider mb-1.5">Existing gist ID (optional)</label>
            <input
              value={gistId}
              onChange={(e) => setGistId(e.target.value)}
              placeholder="Leave empty on first device · paste gist ID on other devices"
              className="w-full bg-cream border border-line rounded-lg px-3 py-2 text-ink text-sm font-mono focus:outline-none focus:border-wood"
              autoComplete="off"
              spellCheck="false"
            />
            <p className="text-xs text-faint mt-1">First device: leave blank, a new private gist is made. After that, copy the gist ID shown here onto your other devices.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setSetupOpen(false); setToken(""); setGistId(""); }} disabled={busy} className="px-3 py-2 rounded-lg text-sm font-semibold text-fade hover:bg-line/50 hover:text-ink transition-colors">
              Cancel
            </button>
            <button onClick={handleConnect} disabled={busy || !token.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold bg-wood hover:bg-wood-dark disabled:opacity-40 disabled:cursor-not-allowed text-cream transition-colors">
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportImportModal({ games, subs, syncState, setSyncState, onPulled, onClose, onImportParsed, onSteamImport, toast }) {
  const fileRef = useRef(null);
  const [steamOpen, setSteamOpen] = useState(false);
  const [steamText, setSteamText] = useState("");
  const [steamResult, setSteamResult] = useState(null);

  const exportJSON = () => {
    downloadFile(`game_library_${todayISO()}.json`, JSON.stringify(games, null, 2), "application/json");
  };

  const exportCSV = () => {
    const cols = ["id", "title", "platform", "source", "status", "rating", "hoursPlayed", "notes", "dateAdded", "completedDate", "leavingSoon"];
    const rows = [cols.join(",")];
    for (const g of games) rows.push(cols.map((c) => csvEscape(g[c])).join(","));
    downloadFile(`game_library_${todayISO()}.csv`, rows.join("\n"), "text/csv");
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("not an array");
      const cleaned = data.map(sanitizeGame).filter(Boolean);
      if (cleaned.length === 0) throw new Error("no valid entries");
      onImportParsed(cleaned);
    } catch {
      toast("Could not read that file — expected a JSON array exported from this app.", "error");
    }
  };

  const runSteamImport = () => {
    try {
      const data = JSON.parse(steamText);
      const list = data?.response?.games;
      if (!Array.isArray(list)) throw new Error("bad shape");
      const result = onSteamImport(list);
      setSteamResult(result);
      setSteamText("");
    } catch {
      setSteamResult(null);
      toast("Invalid Steam JSON. Paste the full response from the GetOwnedGames API URL.", "error");
    }
  };

  const btn = "w-full text-left px-4 py-3 rounded-xl border border-line bg-card hover:border-wood/60 hover:bg-cream transition-colors";

  return (
    <Modal onClose={onClose} wide>
      <div className="p-5 sm:p-6">
        <h2 className="font-display text-2xl font-semibold text-ink mb-1">Sync & Backup</h2>
        <p className="text-sm text-fade mb-4">
          Set up cloud sync to share your library between phone and computer. Or export a JSON backup at any time.
        </p>

        <CloudSyncPanel
          games={games}
          subs={subs}
          syncState={syncState}
          setSyncState={setSyncState}
          onPulled={onPulled}
          toast={toast}
        />

        <div className="grid sm:grid-cols-2 gap-3">
          <button onClick={exportJSON} className={btn}>
            <div className="font-semibold text-ink text-sm">Export JSON</div>
            <div className="text-xs text-fade mt-0.5">Full backup — re-importable</div>
          </button>
          <button onClick={exportCSV} className={btn}>
            <div className="font-semibold text-ink text-sm">Export CSV</div>
            <div className="text-xs text-fade mt-0.5">For spreadsheets</div>
          </button>
          <button onClick={() => fileRef.current?.click()} className={btn}>
            <div className="font-semibold text-ink text-sm">Import JSON</div>
            <div className="text-xs text-fade mt-0.5">Restore a previous export</div>
          </button>
          <button onClick={() => setSteamOpen((v) => !v)} className={btn}>
            <div className="font-semibold text-ink text-sm">Import from Steam</div>
            <div className="text-xs text-fade mt-0.5">Paste GetOwnedGames JSON</div>
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFile} className="hidden" />

        {steamOpen && (
          <div className="mt-4 anim-rise">
            <p className="text-xs text-fade mb-2 leading-relaxed">
              1. Get a free API key at <span className="font-mono text-ink">steamcommunity.com/dev/apikey</span> · 2. Set your Steam profile to public · 3. Open{" "}
              <span className="font-mono text-ink break-all">
                https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=KEY&steamid=ID&include_appinfo=1&format=json
              </span>{" "}
              in your browser · 4. Copy the whole JSON response and paste it below.
            </p>
            <textarea
              value={steamText}
              onChange={(e) => setSteamText(e.target.value)}
              rows={5}
              placeholder='{"response":{"game_count":123,"games":[...]}}'
              className="w-full bg-cream border border-line rounded-lg px-3 py-2 text-ink text-xs font-mono focus:outline-none focus:border-wood"
            />
            <button
              onClick={runSteamImport}
              disabled={!steamText.trim()}
              className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold bg-wood hover:bg-wood-dark disabled:opacity-40 disabled:cursor-not-allowed text-cream transition-colors"
            >
              Parse &amp; Import
            </button>
            {steamResult && (
              <p className="mt-2 text-sm text-sage">
                {steamResult.added} games added, {steamResult.skipped} skipped (already in library).
              </p>
            )}
          </div>
        )}

        <p className="mt-5 text-xs text-faint leading-relaxed">
          PlayStation, Epic, GOG, Prime and Nintendo have no public library APIs — add those games manually.
        </p>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-fade hover:bg-line/50 hover:text-ink transition-colors">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Stats panel                                                          */
/* ------------------------------------------------------------------ */

function Bar({ label, count, max, color }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-fade truncate">{label}</span>
      <div className="flex-1 h-2.5 bg-line/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: max ? `${(count / max) * 100}%` : 0, backgroundColor: color }} />
      </div>
      <span className="w-7 shrink-0 text-right font-mono text-ink">{count}</span>
    </div>
  );
}

function StatsPanel({ games }) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 640);

  const stats = useMemo(() => {
    const byStatus = {};
    const byPlatform = {};
    let subDep = 0;
    let leaving = 0;
    for (const g of games) {
      byStatus[g.status] = (byStatus[g.status] || 0) + 1;
      byPlatform[g.platform] = (byPlatform[g.platform] || 0) + 1;
      if (isSubDependent(g)) subDep++;
      if (g.leavingSoon) leaving++;
    }
    const nonWishlist = games.filter((g) => g.status !== "wishlist").length;
    const completed = byStatus.completed || 0;
    return { byStatus, byPlatform, subDep, leaving, total: games.length, rate: nonWishlist ? Math.round((completed / nonWishlist) * 100) : 0 };
  }, [games]);

  const statusColors = { wishlist: "#56708a", backlog: "#a8957a", playing: "#3e6e64", completed: "#58743d", dropped: "#a8442f", on_hold: "#9c6b1f" };
  const maxStatus = Math.max(0, ...Object.values(stats.byStatus));
  const maxPlatform = Math.max(0, ...Object.values(stats.byPlatform));

  return (
    <section className="bg-cream/80 border border-line rounded-2xl overflow-hidden shadow-sm shadow-wood-dark/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-card transition-colors"
      >
        <span className="font-display font-semibold text-base text-ink">Stats</span>
        <span className="flex items-center gap-3 text-xs text-fade">
          <span className="font-mono text-ink">{stats.total} games</span>
          {stats.subDep > 0 && <span className="text-honey">{stats.subDep} at sub risk</span>}
          {stats.leaving > 0 && <span className="text-clay">{stats.leaving} leaving soon</span>}
          <span className="text-faint">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid sm:grid-cols-2 gap-x-8 gap-y-4 anim-rise">
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold text-faint uppercase tracking-wider mb-2">By Status</h3>
            {Object.entries(STATUSES).map(([k, v]) => (
              <Bar key={k} label={v.label} count={stats.byStatus[k] || 0} max={maxStatus} color={statusColors[k]} />
            ))}
          </div>
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold text-faint uppercase tracking-wider mb-2">By Platform</h3>
            {PLATFORMS.filter((p) => stats.byPlatform[p]).map((p) => (
              <Bar key={p} label={p} count={stats.byPlatform[p]} max={maxPlatform} color={PLATFORM_COLORS[p]} />
            ))}
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-1 text-sm border-t border-line pt-3">
            <span className="text-honey">{stats.subDep} games lost if subscriptions lapse</span>
            <span className="text-clay">{stats.leaving} flagged as leaving soon</span>
            <span className="text-sage">{stats.rate}% completion rate</span>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Filter bar                                                           */
/* ------------------------------------------------------------------ */

function ChipGroup({ label, options, selected, onToggle, render }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-bold text-faint uppercase tracking-wider mr-1">{label}</span>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              active
                ? "bg-wood border-wood-dark text-cream"
                : "bg-cream border-line text-fade hover:border-wood/50 hover:text-ink"
            }`}
          >
            {render ? render(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

function FilterBar({ filters, setFilters }) {
  const toggle = (key) => (val) =>
    setFilters((f) => ({
      ...f,
      [key]: f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val],
    }));

  const activeCount =
    filters.platforms.length + filters.sources.length + filters.statuses.length + (filters.subRisk ? 1 : 0) + (filters.leavingSoon ? 1 : 0);

  const toggleBtn = (active) =>
    `text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
      active ? "bg-honey border-honey text-cream" : "bg-cream border-line text-fade hover:border-wood/50 hover:text-ink"
    }`;

  return (
    <div className="bg-cream/80 border border-line rounded-2xl px-4 py-3 space-y-2.5 shadow-sm shadow-wood-dark/5">
      <ChipGroup label="Platform" options={PLATFORMS} selected={filters.platforms} onToggle={toggle("platforms")} />
      <ChipGroup
        label="Source"
        options={Object.keys(SOURCES)}
        selected={filters.sources}
        onToggle={toggle("sources")}
        render={(s) => SOURCES[s].label}
      />
      <ChipGroup
        label="Status"
        options={Object.keys(STATUSES)}
        selected={filters.statuses}
        onToggle={toggle("statuses")}
        render={(s) => STATUSES[s].label}
      />
      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-line">
        <button onClick={() => setFilters((f) => ({ ...f, subRisk: !f.subRisk }))} className={toggleBtn(filters.subRisk)}>
          ⚠ Subscription Risk
        </button>
        <button onClick={() => setFilters((f) => ({ ...f, leavingSoon: !f.leavingSoon }))} className={toggleBtn(filters.leavingSoon)}>
          ⏳ Leaving Soon
        </button>
        {activeCount > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs font-mono text-wood bg-wood/10 border border-wood/30 px-2 py-0.5 rounded-full">
              {activeCount} active
            </span>
            <button
              onClick={() => setFilters({ platforms: [], sources: [], statuses: [], subRisk: false, leavingSoon: false })}
              className="text-xs font-semibold text-fade hover:text-ink underline underline-offset-2"
            >
              Clear All
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                        */
/* ------------------------------------------------------------------ */

function SubscriptionCard({ sub, onEdit, onRenew }) {
  const days = daysBetween(sub.endDate);
  let tone, label;
  if (days < 0) {
    tone = "expired";
    label = `Expired ${-days} day${-days === 1 ? "" : "s"} ago`;
  } else if (days === 0) {
    tone = "danger";
    label = "Expires today";
  } else if (days <= 7) {
    tone = "danger";
    label = `${days} day${days === 1 ? "" : "s"} left`;
  } else if (days <= 30) {
    tone = "warn";
    label = `${days} days left`;
  } else {
    tone = "ok";
    label = `${days} days left`;
  }

  const toneClasses = {
    ok: "border-sage/40 bg-sage/5",
    warn: "border-honey/40 bg-honey/5",
    danger: "border-clay/50 bg-clay/5",
    expired: "border-clay/60 bg-clay/10",
  };
  const toneText = {
    ok: "text-sage",
    warn: "text-honey",
    danger: "text-clay",
    expired: "text-clay",
  };

  return (
    <div className={`rounded-xl border-2 px-4 py-3 ${toneClasses[tone]}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-base font-semibold text-ink truncate">{sub.name}</div>
          <div className="text-xs text-fade font-mono mt-0.5">Renews {sub.endDate}</div>
          {sub.notes && <div className="text-xs text-faint mt-1 italic truncate" title={sub.notes}>{sub.notes}</div>}
        </div>
        <div className={`text-sm font-bold whitespace-nowrap ${toneText[tone]}`}>{label}</div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-line/60">
        <QuickActionButton tone="wood" onClick={() => onRenew(sub, 1)}>+1 mo</QuickActionButton>
        <QuickActionButton tone="wood" onClick={() => onRenew(sub, 3)}>+3 mo</QuickActionButton>
        <QuickActionButton tone="wood" onClick={() => onRenew(sub, 12)}>+1 yr</QuickActionButton>
        <button onClick={() => onEdit(sub)} className="ml-auto text-xs font-semibold text-fade hover:text-ink underline underline-offset-2">
          Edit
        </button>
      </div>
    </div>
  );
}

function SubscriptionsPanel({ subs, onAdd, onEdit, onRenew }) {
  const [open, setOpen] = useState(true);
  const expiringCount = subs.filter((s) => daysBetween(s.endDate) <= 7).length;

  return (
    <section className="bg-cream/80 border border-line rounded-2xl overflow-hidden shadow-sm shadow-wood-dark/5">
      <div className="w-full flex items-center justify-between px-4 py-3 gap-3">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-3 text-left hover:opacity-80">
          <span className="font-display font-semibold text-base text-ink">Subscriptions</span>
          <span className="text-xs text-fade font-mono">{subs.length} tracked</span>
          {expiringCount > 0 && (
            <span className="text-xs font-semibold text-clay bg-clay/10 border border-clay/30 px-2 py-0.5 rounded-full">
              {expiringCount} expiring soon
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onAdd}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-wood hover:bg-wood-dark text-cream transition-colors"
          >
            + Add
          </button>
          <button onClick={() => setOpen((v) => !v)} className="text-faint text-xs px-1">{open ? "▲" : "▼"}</button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 anim-rise">
          {subs.length === 0 ? (
            <p className="text-sm text-faint italic py-4 text-center">
              No subscriptions tracked yet. Add PS Plus, Prime Gaming, Xbox Game Pass, etc. to see countdown timers.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2.5">
              {subs.map((s) => (
                <SubscriptionCard key={s.id} sub={s} onEdit={onEdit} onRenew={onRenew} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SubscriptionModal({ sub, onSave, onDelete, onClose }) {
  const editing = !!sub;
  const [name, setName] = useState(sub?.name ?? "");
  const [endDate, setEndDate] = useState(sub?.endDate ?? todayISO());
  const [notes, setNotes] = useState(sub?.notes ?? "");
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required."); return; }
    if (!endDate) { setError("End date is required."); return; }
    onSave({
      id: sub?.id ?? crypto.randomUUID(),
      name: name.trim(),
      endDate,
      notes: notes.trim(),
    });
  };

  const field = "w-full bg-cream border border-line rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-wood focus:ring-1 focus:ring-wood/40";
  const label = "block text-xs font-bold text-fade uppercase tracking-wider mb-1.5";

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="p-5 sm:p-6">
        <h2 className="font-display text-2xl font-semibold text-ink mb-5">
          {editing ? "Edit Subscription" : "Add Subscription"}
        </h2>
        <div className="space-y-4">
          <div>
            <label className={label}>Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="e.g. PS Plus Extra, Prime Gaming, Game Pass Ultimate" autoFocus />
          </div>
          <div>
            <label className={label}>Ends on *</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
            <p className="text-xs text-faint mt-1">When you renew, click the +1mo / +3mo / +1yr buttons on the card.</p>
          </div>
          <div>
            <label className={label}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={field} placeholder="e.g. Annual plan, auto-renew off, paid $79.99" />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-clay">{error}</p>}
        <div className="mt-6 flex justify-between gap-2">
          {editing && (
            <button type="button" onClick={() => onDelete(sub)} className="px-4 py-2 rounded-lg text-sm font-semibold text-clay hover:bg-clay/10 transition-colors">
              Delete
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-fade hover:bg-line/50 hover:text-ink transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg text-sm font-semibold bg-wood hover:bg-wood-dark text-cream transition-colors">
              {editing ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Table / cards                                                        */
/* ------------------------------------------------------------------ */

const COLUMNS = [
  { key: "title", label: "Title" },
  { key: "platform", label: "Platform" },
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
  { key: "rating", label: "Rating" },
  { key: "dateAdded", label: "Added" },
];

function GameTable({ games, sort, setSort, onEdit, onDelete, duplicatesMap }) {
  const header = (col) => {
    const active = sort.key === col.key;
    return (
      <th key={col.key} className="px-3 py-2.5 text-left">
        <button
          onClick={() => setSort((s) => (s.key === col.key ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: col.key, dir: "asc" }))}
          className={`text-xs font-bold uppercase tracking-wider transition-colors ${active ? "text-wood" : "text-faint hover:text-fade"}`}
        >
          {col.label} {active ? (sort.dir === "asc" ? "↑" : "↓") : ""}
        </button>
      </th>
    );
  };

  return (
    <>
      {/* Desktop table */}
      <div className="hidden sm:block bg-cream/80 border border-line rounded-2xl overflow-hidden shadow-sm shadow-wood-dark/5">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-card/70">
            <tr>
              {COLUMNS.map(header)}
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const sub = isSubDependent(g);
              return (
                <tr
                  key={g.id}
                  className={`border-b border-line/60 last:border-0 hover:bg-card transition-colors ${
                    g.status === "completed" ? "opacity-60" : ""
                  } ${sub ? "border-l-4 border-l-honey" : "border-l-4 border-l-transparent"}`}
                >
                  <td className="px-3 py-2.5 max-w-[280px]">
                    <button onClick={() => onEdit(g)} className="text-ink font-medium hover:text-wood transition-colors text-left truncate block max-w-full" title={g.title}>
                      {g.title}
                    </button>
                    {duplicatesMap?.get(g.id)?.length > 0 && (
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-faint uppercase tracking-wider">also on</span>
                        {duplicatesMap.get(g.id).map((d) => (
                          <span key={d.id} className="scale-90 origin-left"><PlatformBadge platform={d.platform} /></span>
                        ))}
                      </div>
                    )}
                    {g.notes && <div className="text-xs text-faint truncate" title={g.notes}>{g.notes}</div>}
                  </td>
                  <td className="px-3 py-2.5"><PlatformBadge platform={g.platform} /></td>
                  <td className="px-3 py-2.5"><SourceBadge source={g.source} leavingSoon={g.leavingSoon} /></td>
                  <td className="px-3 py-2.5"><StatusBadge status={g.status} /></td>
                  <td className="px-3 py-2.5 font-mono text-ink">{g.rating ?? <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-fade">{g.dateAdded}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <IconButton onClick={() => onEdit(g)} title="Edit">✎</IconButton>
                    <IconButton onClick={() => onDelete(g)} title="Delete" danger>✕</IconButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-2.5">
        {games.map((g) => {
          const sub = isSubDependent(g);
          return (
            <div
              key={g.id}
              className={`bg-cream/80 border border-line rounded-xl p-3.5 ${sub ? "border-l-4 border-l-honey" : ""} ${
                g.status === "completed" ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => onEdit(g)} className="text-ink font-medium text-left leading-snug">
                  {g.title}
                </button>
                <div className="flex shrink-0">
                  <IconButton onClick={() => onEdit(g)} title="Edit">✎</IconButton>
                  <IconButton onClick={() => onDelete(g)} title="Delete" danger>✕</IconButton>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <PlatformBadge platform={g.platform} />
                <SourceBadge source={g.source} leavingSoon={g.leavingSoon} />
                <StatusBadge status={g.status} />
              </div>
              {duplicatesMap?.get(g.id)?.length > 0 && (
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  <span className="text-[10px] text-faint uppercase tracking-wider">also on</span>
                  {duplicatesMap.get(g.id).map((d) => (
                    <span key={d.id} className="scale-90 origin-left"><PlatformBadge platform={d.platform} /></span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function QuickRow({ g, children }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 bg-cream/80 border border-line rounded-xl px-3.5 py-2.5 shadow-sm shadow-wood-dark/5 ${
        isSubDependent(g) ? "border-l-4 border-l-honey" : ""
      }`}
    >
      <span className="text-sm font-medium text-ink mr-1">{g.title}</span>
      <PlatformBadge platform={g.platform} />
      <SourceBadge source={g.source} leavingSoon={g.leavingSoon} />
      <StatusBadge status={g.status} />
      <span className="ml-auto flex flex-wrap gap-1.5">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Yearly Recap                                                         */
/* ------------------------------------------------------------------ */

function YearlyRecapModal({ games, onClose, onEditGame }) {
  const years = useMemo(() => {
    const set = new Set();
    for (const g of games) {
      if (g.dateAdded) set.add(g.dateAdded.slice(0, 4));
      if (g.completedDate) set.add(g.completedDate.slice(0, 4));
    }
    set.add(new Date().getFullYear().toString());
    return [...set].sort().reverse();
  }, [games]);

  const [year, setYear] = useState(years[0]);

  const recap = useMemo(() => {
    const added = games.filter((g) => g.dateAdded?.startsWith(year));
    const completed = games.filter((g) => g.completedDate?.startsWith(year));

    const byPlatformAdded = {};
    for (const g of added) byPlatformAdded[g.platform] = (byPlatformAdded[g.platform] || 0) + 1;
    const topPlatformEntry = Object.entries(byPlatformAdded).sort((a, b) => b[1] - a[1])[0];

    const ratedCompleted = completed.filter((g) => typeof g.rating === "number");
    const avgRating = ratedCompleted.length
      ? (ratedCompleted.reduce((s, g) => s + g.rating, 0) / ratedCompleted.length).toFixed(1)
      : null;

    const topRated = [...completed]
      .filter((g) => typeof g.rating === "number")
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);

    const currentlyPlaying = games.filter((g) => g.status === "playing");

    const oldestBacklog = [...games]
      .filter((g) => g.status === "backlog" && g.dateAdded)
      .sort((a, b) => a.dateAdded.localeCompare(b.dateAdded))[0];

    return { added, completed, topPlatform: topPlatformEntry, avgRating, topRated, currentlyPlaying, oldestBacklog };
  }, [games, year]);

  const Stat = ({ value, label, tone = "ink" }) => {
    const toneCls = {
      ink: "text-ink",
      sage: "text-sage",
      wood: "text-wood",
      honey: "text-honey",
      clay: "text-clay",
    };
    return (
      <div className="bg-card border border-line rounded-xl px-4 py-3">
        <div className={`font-display text-3xl font-bold leading-none ${toneCls[tone]}`}>{value}</div>
        <div className="text-xs text-fade mt-1.5 uppercase tracking-wider font-semibold">{label}</div>
      </div>
    );
  };

  const linkBtn = "text-left text-sm text-ink hover:text-wood font-medium";

  return (
    <Modal onClose={onClose} wide>
      <div className="p-5 sm:p-7">
        <div className="flex items-end justify-between gap-3 mb-5">
          <div>
            <p className="text-xs text-fade uppercase tracking-[0.2em] font-bold mb-1">Year in Review</p>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink leading-tight">
              <span className="italic text-wood">{year}</span>
            </h2>
          </div>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="bg-cream border border-line rounded-lg px-3 py-1.5 text-sm font-mono text-ink focus:outline-none focus:border-wood"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
          <Stat value={recap.completed.length} label="Completed" tone="sage" />
          <Stat value={recap.added.length} label="Added" tone="wood" />
          <Stat value={recap.currentlyPlaying.length} label="Playing now" tone="ink" />
          <Stat value={recap.avgRating ?? "—"} label="Avg rating" tone="honey" />
        </div>

        <div className="space-y-4">
          {recap.topPlatform && (
            <div className="bg-card border border-line rounded-xl px-4 py-3 flex items-center gap-3">
              <PlatformBadge platform={recap.topPlatform[0]} />
              <div>
                <div className="text-sm text-ink"><strong>{recap.topPlatform[0]}</strong> was your most-added platform</div>
                <div className="text-xs text-fade">{recap.topPlatform[1]} games added in {year}</div>
              </div>
            </div>
          )}

          {recap.topRated.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-faint uppercase tracking-wider mb-2">Top rated completions</h3>
              <div className="space-y-1.5">
                {recap.topRated.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 bg-card border border-line rounded-lg px-3 py-2">
                    <span className="font-display text-lg font-bold text-honey w-9 tabular-nums">{g.rating}</span>
                    <button onClick={() => { onEditGame(g); onClose(); }} className={linkBtn + " flex-1 truncate"}>{g.title}</button>
                    <PlatformBadge platform={g.platform} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {recap.oldestBacklog && (
            <div className="bg-clay/5 border border-clay/30 rounded-xl px-4 py-3">
              <div className="text-xs font-bold text-clay uppercase tracking-wider mb-1">Longest in backlog</div>
              <button onClick={() => { onEditGame(recap.oldestBacklog); onClose(); }} className={linkBtn}>
                {recap.oldestBacklog.title}
              </button>
              <div className="text-xs text-fade font-mono mt-0.5">Added {recap.oldestBacklog.dateAdded} · still untouched</div>
            </div>
          )}

          {recap.added.length === 0 && recap.completed.length === 0 && (
            <p className="text-sm text-faint italic text-center py-6">No activity tracked for {year}.</p>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-fade hover:bg-line/50 hover:text-ink transition-colors">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Main App                                                             */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: "all", label: "All" },
  { id: "psplus", label: "PS Plus" },
  { id: "prime", label: "Prime Catalog" },
  { id: "wishlist", label: "Wishlist" },
  { id: "leaving", label: "Leaving Soon" },
];

export default function App() {
  const [games, setGames] = useState(null); // null = not loaded yet
  const [subs, setSubs] = useState([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [filters, setFilters] = useState({ platforms: [], sources: [], statuses: [], subRisk: false, leavingSoon: false });
  const [sort, setSort] = useState({ key: "dateAdded", dir: "desc" });
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [syncState, setSyncState] = useState({ state: sync.isConfigured() ? "ok" : "off", at: sync.getLastSync() });
  const searchRef = useRef(null);
  const loadedRef = useRef(false);
  const applyingRemoteRef = useRef(false);
  const pushTimerRef = useRef(null);
  const initialPullDoneRef = useRef(false);

  const toast = useCallback((msg, type = "info") => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  /* ---- load / persist ---- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        setGames(SAMPLE_DATA);
      } else {
        const parsed = JSON.parse(raw);
        setGames(Array.isArray(parsed) ? parsed : SAMPLE_DATA);
      }
    } catch {
      setGames(SAMPLE_DATA);
      toast("Could not load saved library — starting with sample data.", "error");
    }
    try {
      const raw = localStorage.getItem(SUBS_KEY);
      if (raw === null) {
        setSubs(SAMPLE_SUBS);
      } else {
        const parsed = JSON.parse(raw);
        setSubs(Array.isArray(parsed) ? parsed.map(sanitizeSub).filter(Boolean) : []);
      }
    } catch {
      setSubs([]);
    }
  }, [toast]);

  useEffect(() => {
    try {
      localStorage.setItem(SUBS_KEY, JSON.stringify(subs));
    } catch {
      /* ignore */
    }
  }, [subs]);

  useEffect(() => {
    if (games === null) return;
    if (!loadedRef.current) {
      loadedRef.current = true;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
    } catch {
      toast("Failed to save your library (storage full or blocked).", "error");
    }
  }, [games, toast]);

  // Initial pull on load (if sync configured)
  useEffect(() => {
    if (games === null) return;
    if (initialPullDoneRef.current) return;
    initialPullDoneRef.current = true;
    if (!sync.isConfigured()) return;
    setSyncState((s) => ({ ...s, state: "syncing" }));
    sync.pull()
      .then(({ data }) => {
        if (data?.games?.length >= 0) {
          applyingRemoteRef.current = true;
          setGames(data.games);
          setSubs(Array.isArray(data.subscriptions) ? data.subscriptions : []);
          sync.setLastSync(new Date().toISOString());
          setSyncState({ state: "ok", at: new Date().toISOString() });
        }
      })
      .catch((e) => {
        setSyncState({ state: "error", message: e.message });
        toast(`Cloud pull failed: ${e.message}`, "error");
      });
  }, [games, toast]);

  // Debounced auto-push when games/subs change
  useEffect(() => {
    if (games === null) return;
    if (!sync.isConfigured()) return;
    if (applyingRemoteRef.current) { applyingRemoteRef.current = false; return; }
    clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(async () => {
      setSyncState((s) => ({ ...s, state: "syncing" }));
      try {
        await sync.push(games, subs);
        setSyncState({ state: "ok", at: new Date().toISOString() });
      } catch (e) {
        setSyncState({ state: "error", message: e.message });
      }
    }, 2000);
    return () => clearTimeout(pushTimerRef.current);
  }, [games, subs]);

  const handlePulled = useCallback((data) => {
    applyingRemoteRef.current = true;
    setGames(data.games);
    setSubs(Array.isArray(data.subscriptions) ? data.subscriptions : []);
  }, []);

  /* ---- keyboard shortcuts ---- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setModal(null);
        return;
      }
      const tag = e.target.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setModal({ type: "add" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (window.innerWidth >= 768) searchRef.current?.focus();
  }, []);

  /* ---- mutations ---- */
  const upsertGame = (g) => {
    setGames((gs) => {
      const exists = gs.some((x) => x.id === g.id);
      if (exists) {
        return gs.map((x) => {
          if (x.id !== g.id) return x;
          const next = { ...g };
          // completedDate auto-set / auto-clear
          if (next.status === "completed") {
            next.completedDate = x.status === "completed" ? x.completedDate ?? todayISO() : todayISO();
          } else {
            delete next.completedDate;
          }
          if (!isSubDependent(next)) delete next.leavingSoon;
          return next;
        });
      }
      return [...gs, g];
    });
    setModal(null);
    toast(games?.some((x) => x.id === g.id) ? "Saved." : `Added "${g.title}".`, "success");
  };

  const patchGame = (id, patch, msg) => {
    setGames((gs) =>
      gs.map((g) => {
        if (g.id !== id) return g;
        const next = { ...g, ...patch };
        if (!isSubDependent(next)) delete next.leavingSoon;
        return next;
      })
    );
    if (msg) toast(msg, "success");
  };

  const deleteGame = (g) => {
    setGames((gs) => gs.filter((x) => x.id !== g.id));
    setModal(null);
    toast(`Deleted "${g.title}".`, "success");
  };

  const handleImportParsed = (incoming) => {
    const ids = new Set(games.map((g) => g.id));
    const conflicts = incoming.filter((g) => ids.has(g.id));
    if (conflicts.length > 0) {
      setModal({ type: "conflict", incoming, conflictCount: conflicts.length });
    } else {
      setGames((gs) => [...gs, ...incoming]);
      setModal(null);
      toast(`Imported ${incoming.length} games.`, "success");
    }
  };

  const resolveConflict = (mode) => {
    const { incoming } = modal;
    if (mode === "cancel") {
      setModal(null);
      return;
    }
    setGames((gs) => {
      const byId = new Map(gs.map((g) => [g.id, g]));
      let added = 0;
      for (const g of incoming) {
        if (byId.has(g.id)) {
          if (mode === "overwrite") byId.set(g.id, g);
        } else {
          byId.set(g.id, g);
          added++;
        }
      }
      return [...byId.values()];
    });
    setModal(null);
    toast(mode === "overwrite" ? `Imported ${incoming.length} games (conflicts overwritten).` : `Imported new games, skipped existing ones.`, "success");
  };

  const saveSub = (s) => {
    setSubs((ss) => {
      const exists = ss.some((x) => x.id === s.id);
      return exists ? ss.map((x) => (x.id === s.id ? s : x)) : [...ss, s];
    });
    setModal(null);
    toast(`Saved subscription "${s.name}".`, "success");
  };

  const deleteSub = (s) => {
    setSubs((ss) => ss.filter((x) => x.id !== s.id));
    setModal(null);
    toast(`Removed "${s.name}".`, "success");
  };

  const renewSub = (s, months) => {
    const next = { ...s, endDate: addMonths(s.endDate, months) };
    setSubs((ss) => ss.map((x) => (x.id === s.id ? next : x)));
    toast(`"${s.name}" renewed — now ends ${next.endDate}.`, "success");
  };

  const handleSteamImport = (list) => {
    const existing = new Set(games.map((g) => g.title.toLowerCase()));
    const added = [];
    let skipped = 0;
    for (const item of list) {
      const name = item?.name;
      if (!name) continue;
      if (existing.has(name.toLowerCase())) {
        skipped++;
        continue;
      }
      const g = {
        id: crypto.randomUUID(),
        title: name,
        platform: "Steam",
        source: "purchased",
        status: "backlog",
        dateAdded: todayISO(),
      };
      const mins = item.playtime_forever;
      if (typeof mins === "number" && mins > 0) g.hoursPlayed = Math.round((mins / 60) * 10) / 10;
      existing.add(name.toLowerCase());
      added.push(g);
    }
    if (added.length > 0) setGames((gs) => [...gs, ...added]);
    toast(`Steam import: ${added.length} added, ${skipped} skipped.`, "success");
    return { added: added.length, skipped };
  };

  /* ---- derived lists ---- */
  const quickMatches = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    return (games ?? []).filter((g) => fuzzyMatch(g.title, q) || (g.notes && norm(g.notes).includes(norm(q))));
  }, [query, games]);

  const visibleGames = useMemo(() => {
    if (!games) return [];
    let list = games;

    if (tab === "psplus") list = list.filter((g) => g.source === "ps_plus_monthly" || g.source === "ps_plus_catalog");
    else if (tab === "prime") list = list.filter((g) => g.source === "prime_gaming_catalog");
    else if (tab === "wishlist") list = list.filter((g) => g.status === "wishlist");
    else if (tab === "leaving") list = list.filter((g) => g.leavingSoon === true);

    const q = query.trim();
    if (q) list = list.filter((g) => fuzzyMatch(g.title, q) || (g.notes && norm(g.notes).includes(norm(q))));

    if (tab === "all") {
      const f = filters;
      if (f.platforms.length) list = list.filter((g) => f.platforms.includes(g.platform));
      if (f.sources.length) list = list.filter((g) => f.sources.includes(g.source));
      if (f.statuses.length) list = list.filter((g) => f.statuses.includes(g.status));
      if (f.subRisk) list = list.filter(isSubDependent);
      if (f.leavingSoon) list = list.filter((g) => g.leavingSoon === true);
    }

    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      let va = a[sort.key];
      let vb = b[sort.key];
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      if (typeof va === "string") {
        va = va.toLowerCase();
        vb = String(vb).toLowerCase();
        return va.localeCompare(vb) * dir;
      }
      return (va - vb) * dir;
    });
  }, [games, tab, query, filters, sort]);

  const duplicatesMap = useMemo(() => {
    const m = new Map();
    if (!games) return m;
    for (let i = 0; i < games.length; i++) {
      const dups = [];
      for (let j = 0; j < games.length; j++) {
        if (i === j) continue;
        if (fuzzyMatch(games[i].title, games[j].title)) dups.push(games[j]);
      }
      if (dups.length) m.set(games[i].id, dups);
    }
    return m;
  }, [games]);

  const activeFilterCount =
    filters.platforms.length + filters.sources.length + filters.statuses.length + (filters.subRisk ? 1 : 0) + (filters.leavingSoon ? 1 : 0);

  if (games === null) {
    return <div className="min-h-screen flex items-center justify-center text-fade font-mono text-sm">Loading…</div>;
  }

  const renderQuickActions = (g) => (
    <>
      <QuickActionButton tone="wood" onClick={() => patchGame(g.id, { source: "purchased", leavingSoon: undefined }, `"${g.title}" marked as purchased.`)}>
        Mark Purchased
      </QuickActionButton>
      <QuickActionButton tone="amber" onClick={() => patchGame(g.id, { leavingSoon: !g.leavingSoon })}>
        {g.leavingSoon ? "Unflag Leaving" : "Leaving Soon"}
      </QuickActionButton>
      <QuickActionButton tone="red" onClick={() => setModal({ type: "delete", game: g })}>
        Remove
      </QuickActionButton>
    </>
  );

  return (
    <div className="min-h-screen text-ink pb-20">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 pt-6 sm:pt-10">
        {/* Wood header */}
        <header className="wood-panel rounded-2xl px-5 sm:px-7 py-5 sm:py-6 flex flex-wrap items-end justify-between gap-4 mb-6 anim-rise">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#f5ead3]">
              Game <span className="italic text-[#e8c896]">Vault</span>
            </h1>
            <p className="text-xs mt-1.5 font-mono text-[#d8c2a0]/80 flex items-center gap-2">
              <span>{games.length} games · NS1 / NS2 / PS / Steam / Epic / GOG / Prime</span>
              {sync.isConfigured() && (
                <button
                  onClick={() => setModal({ type: "io" })}
                  title={syncState.state === "ok" ? `Synced ${sync.relativeTime(syncState.at)}` : syncState.state === "syncing" ? "Syncing…" : syncState.state === "error" ? syncState.message : "Connected"}
                  className="inline-flex items-center gap-1 hover:opacity-80"
                >
                  <span className={`w-2 h-2 rounded-full ${
                    syncState.state === "ok" ? "bg-emerald-300" :
                    syncState.state === "syncing" ? "bg-amber-300 animate-pulse" :
                    syncState.state === "error" ? "bg-red-300" : "bg-[#d8c2a0]"
                  }`}></span>
                  <span className="text-[10px] uppercase tracking-wider">cloud</span>
                </button>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setModal({ type: "recap" })}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-[#caa978]/40 text-[#f0e2c8] hover:bg-[#f0e2c8]/10 transition-colors"
            >
              Recap
            </button>
            <button
              onClick={() => setModal({ type: "io" })}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-[#caa978]/40 text-[#f0e2c8] hover:bg-[#f0e2c8]/10 transition-colors"
            >
              Export / Import
            </button>
            <button
              onClick={() => setModal({ type: "add" })}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold bg-[#f0e2c8] hover:bg-[#fbf2dd] text-wood-dark transition-colors shadow-lg shadow-black/20"
            >
              + Add Game <span className="hidden sm:inline opacity-50 font-mono text-xs ml-1">N</span>
            </button>
          </div>
        </header>

        {/* Quick Check search */}
        <div className="mb-4 anim-rise" style={{ animationDelay: "60ms" }}>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-faint text-lg pointer-events-none">⌕</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quick Check — do I already own this game?  ( / )"
              className="w-full bg-cream border-2 border-line focus:border-wood rounded-2xl pl-11 pr-10 py-3.5 text-base text-ink placeholder-faint focus:outline-none focus:ring-2 focus:ring-wood/20 transition-colors shadow-sm shadow-wood-dark/5"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink p-1"
                title="Clear"
              >
                ✕
              </button>
            )}
          </div>

          {quickMatches !== null && (
            <div className="mt-2.5 anim-rise">
              {quickMatches.length === 0 ? (
                <div className="rounded-xl border border-sage/40 bg-sage/10 px-4 py-3 text-sage font-semibold text-sm">
                  ✓ Not in your library — safe to buy.
                </div>
              ) : (
                <div className="rounded-xl border border-honey/40 bg-honey/10 px-4 py-3">
                  <p className="text-honey font-semibold text-sm mb-2">
                    Found {quickMatches.length} match{quickMatches.length > 1 ? "es" : ""} in your library:
                  </p>
                  <div className="space-y-1.5">
                    {quickMatches.map((g) => (
                      <div key={g.id} className="flex flex-wrap items-center gap-1.5 text-sm">
                        <button onClick={() => setModal({ type: "edit", game: g })} className="text-ink font-medium hover:text-wood mr-1">
                          {g.title}
                        </button>
                        <PlatformBadge platform={g.platform} />
                        <SourceBadge source={g.source} leavingSoon={g.leavingSoon} />
                        <StatusBadge status={g.status} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <nav className="flex gap-1.5 mb-4 overflow-x-auto pb-1 anim-rise" style={{ animationDelay: "100ms" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === t.id ? "bg-wood text-cream shadow-sm" : "bg-cream text-fade border border-line hover:text-ink hover:border-wood/40"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="space-y-4">
          <div className="anim-rise" style={{ animationDelay: "120ms" }}>
            <SubscriptionsPanel
              subs={subs}
              onAdd={() => setModal({ type: "sub-add" })}
              onEdit={(s) => setModal({ type: "sub-edit", sub: s })}
              onRenew={renewSub}
            />
          </div>
          <div className="anim-rise" style={{ animationDelay: "160ms" }}>
            <StatsPanel games={games} />
          </div>

          {tab === "all" && (
            <div className="anim-rise" style={{ animationDelay: "180ms" }}>
              <FilterBar filters={filters} setFilters={setFilters} />
            </div>
          )}

          {/* Content */}
          <main className="anim-rise" style={{ animationDelay: "220ms" }}>
            {games.length === 0 ? (
              <div className="text-center py-20 bg-cream/60 border border-dashed border-line rounded-2xl">
                <p className="font-display text-2xl font-semibold text-ink mb-3">Your library is empty</p>
                <p className="text-sm text-fade mb-5">Add your first game to start tracking.</p>
                <button onClick={() => setModal({ type: "add" })} className="px-5 py-2.5 rounded-xl font-semibold bg-wood hover:bg-wood-dark text-cream transition-colors">
                  + Add your first game
                </button>
              </div>
            ) : tab === "psplus" ? (
              <div className="space-y-5">
                {["ps_plus_monthly", "ps_plus_catalog"].map((src) => {
                  const group = visibleGames.filter((g) => g.source === src);
                  return (
                    <section key={src}>
                      <h2 className="font-display text-lg font-semibold text-ink mb-2">
                        {src === "ps_plus_monthly" ? "Monthly (Claimed)" : "Catalog"}{" "}
                        <span className="font-mono text-sm text-faint">({group.length})</span>
                      </h2>
                      {group.length === 0 ? (
                        <p className="text-sm text-faint italic">None tracked.</p>
                      ) : (
                        <div className="space-y-2">{group.map((g) => <QuickRow key={g.id} g={g}>{renderQuickActions(g)}</QuickRow>)}</div>
                      )}
                    </section>
                  );
                })}
                <a
                  href="https://store.playstation.com/zh-tw-HK/pages/ps-plus"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm text-wood hover:text-wood-dark underline underline-offset-2"
                >
                  Check Taiwan PS Plus Catalog →
                </a>
              </div>
            ) : tab === "prime" ? (
              <div className="space-y-2">
                {visibleGames.length === 0 ? (
                  <p className="text-sm text-fade text-center py-10">No Prime Gaming Collection games tracked.</p>
                ) : (
                  visibleGames.map((g) => <QuickRow key={g.id} g={g}>{renderQuickActions(g)}</QuickRow>)
                )}
              </div>
            ) : tab === "wishlist" ? (
              <div className="space-y-2">
                {visibleGames.length === 0 ? (
                  <p className="text-sm text-fade text-center py-10">Wishlist is empty.</p>
                ) : (
                  visibleGames.map((g) => (
                    <QuickRow key={g.id} g={g}>
                      <QuickActionButton
                        tone="wood"
                        onClick={() => patchGame(g.id, { status: "backlog", source: "purchased" }, `"${g.title}" purchased → moved to backlog.`)}
                      >
                        Mark Purchased
                      </QuickActionButton>
                      <QuickActionButton tone="red" onClick={() => setModal({ type: "delete", game: g })}>
                        Remove
                      </QuickActionButton>
                    </QuickRow>
                  ))
                )}
              </div>
            ) : tab === "leaving" ? (
              <div className="space-y-2">
                {visibleGames.length === 0 ? (
                  <p className="text-sm text-fade text-center py-10">Nothing flagged as leaving soon. 🎉</p>
                ) : (
                  visibleGames.map((g) => <QuickRow key={g.id} g={g}>{renderQuickActions(g)}</QuickRow>)
                )}
              </div>
            ) : visibleGames.length === 0 ? (
              <div className="text-center py-16 bg-cream/60 border border-dashed border-line rounded-2xl">
                <p className="text-fade mb-3">No games match your filters.</p>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => setFilters({ platforms: [], sources: [], statuses: [], subRisk: false, leavingSoon: false })}
                    className="px-4 py-2 rounded-lg text-sm font-semibold border border-line text-ink hover:bg-card transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <GameTable
                games={visibleGames}
                sort={sort}
                setSort={setSort}
                onEdit={(g) => setModal({ type: "edit", game: g })}
                onDelete={(g) => setModal({ type: "delete", game: g })}
                duplicatesMap={duplicatesMap}
              />
            )}
          </main>
        </div>

        <footer className="mt-10 text-center text-xs text-faint leading-relaxed">
          Data is stored in this browser only (localStorage) — use <strong className="text-fade">Export JSON</strong> for backups or to move devices.
          <br />
          Shortcuts: <kbd className="font-mono text-fade">N</kbd> add · <kbd className="font-mono text-fade">/</kbd> search ·{" "}
          <kbd className="font-mono text-fade">Esc</kbd> close
        </footer>
      </div>

      {/* Modals */}
      {modal?.type === "add" && <AddEditModal games={games} onSave={upsertGame} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <AddEditModal game={modal.game} games={games} onSave={upsertGame} onClose={() => setModal(null)} />}
      {modal?.type === "io" && (
        <ExportImportModal
          games={games}
          subs={subs}
          syncState={syncState}
          setSyncState={setSyncState}
          onPulled={handlePulled}
          onClose={() => setModal(null)}
          onImportParsed={handleImportParsed}
          onSteamImport={handleSteamImport}
          toast={toast}
        />
      )}
      {modal?.type === "sub-add" && (
        <SubscriptionModal onSave={saveSub} onDelete={deleteSub} onClose={() => setModal(null)} />
      )}
      {modal?.type === "sub-edit" && (
        <SubscriptionModal sub={modal.sub} onSave={saveSub} onDelete={deleteSub} onClose={() => setModal(null)} />
      )}
      {modal?.type === "recap" && (
        <YearlyRecapModal games={games} onClose={() => setModal(null)} onEditGame={(g) => setModal({ type: "edit", game: g })} />
      )}
      {modal?.type === "delete" && (
        <Modal onClose={() => setModal(null)}>
          <div className="p-6">
            <h2 className="font-display text-xl font-semibold text-ink mb-2">Delete game?</h2>
            <p className="text-sm text-fade mb-5">
              "<span className="text-ink">{modal.game.title}</span>" ({modal.game.platform}) will be permanently removed.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-sm font-semibold text-fade hover:bg-line/50 hover:text-ink transition-colors">
                Cancel
              </button>
              <button onClick={() => deleteGame(modal.game)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-clay hover:bg-[#8e3826] text-cream transition-colors">
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal?.type === "conflict" && (
        <Modal onClose={() => setModal(null)}>
          <div className="p-6">
            <h2 className="font-display text-xl font-semibold text-ink mb-2">Import conflict</h2>
            <p className="text-sm text-fade mb-5">
              {modal.conflictCount} game{modal.conflictCount > 1 ? "s" : ""} in this file already exist in your library (same ID).
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => resolveConflict("cancel")} className="px-4 py-2 rounded-lg text-sm font-semibold text-fade hover:bg-line/50 hover:text-ink transition-colors">
                Cancel
              </button>
              <button onClick={() => resolveConflict("skip")} className="px-4 py-2 rounded-lg text-sm font-semibold border border-line text-ink hover:bg-card transition-colors">
                Skip Existing
              </button>
              <button onClick={() => resolveConflict("overwrite")} className="px-4 py-2 rounded-lg text-sm font-semibold bg-wood hover:bg-wood-dark text-cream transition-colors">
                Overwrite
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[60] space-y-2 max-w-sm">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
            className={`anim-pop block w-full text-left px-4 py-3 rounded-xl text-sm font-medium shadow-xl border ${
              t.type === "error"
                ? "bg-[#f6e2db] border-clay/40 text-clay"
                : t.type === "success"
                ? "bg-[#e9efdc] border-sage/40 text-sage"
                : "bg-cream border-line text-ink"
            }`}
          >
            {t.msg}
          </button>
        ))}
      </div>
    </div>
  );
}
