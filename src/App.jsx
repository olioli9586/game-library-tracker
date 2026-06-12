import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                  */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "game_library_v2";

const PLATFORMS = ["NS1", "NS2", "PS4", "PS5", "Steam", "Epic", "GOG", "Prime"];

const PLATFORM_COLORS = {
  NS1: "#E60012",
  NS2: "#8B0000",
  PS4: "#003088",
  PS5: "#003088",
  Steam: "#1B2838",
  Epic: "#3D3D3D",
  GOG: "#5C2D8F",
  Prime: "#FF9900",
};

const SOURCES = {
  purchased: { label: "Purchased", permanent: true },
  ps_plus_monthly: { label: "PS Plus Monthly", permanent: false },
  ps_plus_catalog: { label: "PS Plus Catalog", permanent: false },
  epic_free: { label: "Epic Free", permanent: true },
  prime_gaming: { label: "Prime Gaming (Claimed)", permanent: true },
  prime_gaming_catalog: { label: "Prime Collection", permanent: false },
  physical: { label: "Physical", permanent: true },
};

const STATUSES = {
  wishlist: { label: "Wishlist", cls: "bg-sky-500/15 text-sky-300 border-sky-400/30" },
  backlog: { label: "Backlog", cls: "bg-gray-500/15 text-gray-300 border-gray-400/30" },
  playing: { label: "Playing", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-400/30" },
  completed: { label: "Completed", cls: "bg-green-500/15 text-green-300 border-green-400/30" },
  dropped: { label: "Dropped", cls: "bg-red-500/15 text-red-300 border-red-400/30" },
  on_hold: { label: "On Hold", cls: "bg-amber-500/15 text-amber-300 border-amber-400/30" },
};

const SUB_SOURCES = ["ps_plus_monthly", "ps_plus_catalog", "prime_gaming_catalog"];
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
      list = ["purchased", "physical"];
      break;
    case "PS4":
    case "PS5":
      list = ["purchased", "physical", "ps_plus_monthly", "ps_plus_catalog"];
      break;
    case "Steam":
      list = ["purchased", "prime_gaming"];
      break;
    case "Epic":
      list = ["purchased", "epic_free", "prime_gaming"];
      break;
    case "GOG":
      list = ["purchased", "prime_gaming"];
      break;
    case "Prime":
      list = ["prime_gaming", "prime_gaming_catalog"];
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
      className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full text-white border border-white/15 whitespace-nowrap"
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
          sub
            ? "bg-amber-500/15 text-amber-300 border-amber-400/40"
            : "bg-emerald-500/10 text-emerald-300 border-emerald-400/30"
        }`}
      >
        {meta?.label ?? source}
      </span>
      {leavingSoon && (
        <span
          title="Leaving soon"
          className="inline-flex items-center justify-center text-xs font-bold w-5 h-5 rounded-full bg-red-500/20 text-red-400 border border-red-400/50"
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
        danger ? "text-red-400 hover:bg-red-500/15" : "text-gray-400 hover:bg-gray-700/60 hover:text-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

function QuickActionButton({ onClick, children, tone = "indigo" }) {
  const tones = {
    indigo: "bg-indigo-600/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-600/35",
    amber: "bg-amber-600/20 text-amber-300 border-amber-500/40 hover:bg-amber-600/35",
    red: "bg-red-600/20 text-red-300 border-red-500/40 hover:bg-red-600/35",
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
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`anim-pop w-full ${wide ? "max-w-2xl" : "max-w-lg"} bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl shadow-black/60 my-6`}
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
  const [hours, setHours] = useState(game?.hoursPlayed?.toString() ?? "");
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
    const hoursNum = hours === "" ? undefined : Math.max(0, Number(hours));
    const next = {
      id: game?.id ?? crypto.randomUUID(),
      title: title.trim(),
      platform,
      source,
      status,
      dateAdded: game?.dateAdded ?? todayISO(),
    };
    if (ratingNum !== undefined && !Number.isNaN(ratingNum)) next.rating = ratingNum;
    if (hoursNum !== undefined && !Number.isNaN(hoursNum)) next.hoursPlayed = hoursNum;
    if (notes.trim()) next.notes = notes.trim();
    if (subDep && leavingSoon) next.leavingSoon = true;
    if (status === "completed") next.completedDate = game?.completedDate ?? todayISO();
    onSave(next);
  };

  const field = "w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50";
  const label = "block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5";

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="p-5 sm:p-6">
        <h2 className="font-display text-xl font-bold text-gray-100 mb-5">
          {editing ? "Edit Game" : "Add Game"}
        </h2>

        <div className="space-y-4">
          <div>
            <label className={label}>Title *</label>
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} className={field} placeholder="e.g. Elden Ring" />
            {duplicates.length > 0 && (
              <div className="mt-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2 space-y-0.5">
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

          <div>
            <label className={label}>Hours played</label>
            <input type="number" min="0" step="0.1" value={hours} onChange={(e) => setHours(e.target.value)} className={field} placeholder="—" />
          </div>

          {subDep && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none bg-amber-500/5 border border-amber-400/20 rounded-lg px-3 py-2.5">
              <input type="checkbox" checked={leavingSoon} onChange={(e) => setLeavingSoon(e.target.checked)} className="accent-amber-500 w-4 h-4" />
              <span className="text-sm text-amber-200">Leaving soon (removal announced)</span>
            </label>
          )}

          <div>
            <label className={label}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={field} placeholder="e.g. Redeemed on GOG via Prime Gaming" />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
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

function ExportImportModal({ games, onClose, onImportParsed, onSteamImport, toast }) {
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

  const btn = "w-full text-left px-4 py-3 rounded-xl border border-gray-700 bg-gray-950/60 hover:border-indigo-500/60 hover:bg-gray-800/60 transition-colors";

  return (
    <Modal onClose={onClose} wide>
      <div className="p-5 sm:p-6">
        <h2 className="font-display text-xl font-bold text-gray-100 mb-1">Export / Import</h2>
        <p className="text-sm text-gray-400 mb-5">
          Your library lives in this browser. Export a JSON backup regularly.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <button onClick={exportJSON} className={btn}>
            <div className="font-semibold text-gray-100 text-sm">Export JSON</div>
            <div className="text-xs text-gray-400 mt-0.5">Full backup — re-importable</div>
          </button>
          <button onClick={exportCSV} className={btn}>
            <div className="font-semibold text-gray-100 text-sm">Export CSV</div>
            <div className="text-xs text-gray-400 mt-0.5">For spreadsheets</div>
          </button>
          <button onClick={() => fileRef.current?.click()} className={btn}>
            <div className="font-semibold text-gray-100 text-sm">Import JSON</div>
            <div className="text-xs text-gray-400 mt-0.5">Restore a previous export</div>
          </button>
          <button onClick={() => setSteamOpen((v) => !v)} className={btn}>
            <div className="font-semibold text-gray-100 text-sm">Import from Steam</div>
            <div className="text-xs text-gray-400 mt-0.5">Paste GetOwnedGames JSON</div>
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFile} className="hidden" />

        {steamOpen && (
          <div className="mt-4 anim-rise">
            <p className="text-xs text-gray-400 mb-2 leading-relaxed">
              1. Get a free API key at <span className="font-mono text-gray-300">steamcommunity.com/dev/apikey</span> · 2. Set your Steam profile to public · 3. Open{" "}
              <span className="font-mono text-gray-300 break-all">
                https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=KEY&steamid=ID&include_appinfo=1&format=json
              </span>{" "}
              in your browser · 4. Copy the whole JSON response and paste it below.
            </p>
            <textarea
              value={steamText}
              onChange={(e) => setSteamText(e.target.value)}
              rows={5}
              placeholder='{"response":{"game_count":123,"games":[...]}}'
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 text-xs font-mono focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={runSteamImport}
              disabled={!steamText.trim()}
              className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              Parse &amp; Import
            </button>
            {steamResult && (
              <p className="mt-2 text-sm text-green-400">
                {steamResult.added} games added, {steamResult.skipped} skipped (already in library).
              </p>
            )}
          </div>
        )}

        <p className="mt-5 text-xs text-gray-500 leading-relaxed">
          PlayStation, Epic, GOG, Prime and Nintendo have no public library APIs — add those games manually.
        </p>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors">
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
      <span className="w-20 shrink-0 text-gray-400 truncate">{label}</span>
      <div className="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: max ? `${(count / max) * 100}%` : 0, backgroundColor: color }} />
      </div>
      <span className="w-7 shrink-0 text-right font-mono text-gray-300">{count}</span>
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

  const statusColors = { wishlist: "#38bdf8", backlog: "#9ca3af", playing: "#818cf8", completed: "#4ade80", dropped: "#f87171", on_hold: "#fbbf24" };
  const maxStatus = Math.max(0, ...Object.values(stats.byStatus));
  const maxPlatform = Math.max(0, ...Object.values(stats.byPlatform));

  return (
    <section className="bg-gray-900/70 border border-gray-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/40 transition-colors"
      >
        <span className="font-display font-bold text-sm text-gray-200 uppercase tracking-wider">Stats</span>
        <span className="flex items-center gap-3 text-xs text-gray-400">
          <span className="font-mono text-gray-200">{stats.total} games</span>
          {stats.subDep > 0 && <span className="text-amber-400">{stats.subDep} at sub risk</span>}
          {stats.leaving > 0 && <span className="text-red-400">{stats.leaving} leaving soon</span>}
          <span className="text-gray-500">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid sm:grid-cols-2 gap-x-8 gap-y-4 anim-rise">
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">By Status</h3>
            {Object.entries(STATUSES).map(([k, v]) => (
              <Bar key={k} label={v.label} count={stats.byStatus[k] || 0} max={maxStatus} color={statusColors[k]} />
            ))}
          </div>
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">By Platform</h3>
            {PLATFORMS.filter((p) => stats.byPlatform[p]).map((p) => (
              <Bar key={p} label={p} count={stats.byPlatform[p]} max={maxPlatform} color={PLATFORM_COLORS[p]} />
            ))}
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-1 text-sm border-t border-gray-800 pt-3">
            <span className="text-amber-300">{stats.subDep} games lost if subscriptions lapse</span>
            <span className="text-red-300">{stats.leaving} flagged as leaving soon</span>
            <span className="text-green-300">{stats.rate}% completion rate</span>
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
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">{label}</span>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              active
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
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
      active ? "bg-amber-600/80 border-amber-500 text-white" : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
    }`;

  return (
    <div className="bg-gray-900/70 border border-gray-800 rounded-2xl px-4 py-3 space-y-2.5">
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
      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-gray-800">
        <button onClick={() => setFilters((f) => ({ ...f, subRisk: !f.subRisk }))} className={toggleBtn(filters.subRisk)}>
          ⚠ Subscription Risk
        </button>
        <button onClick={() => setFilters((f) => ({ ...f, leavingSoon: !f.leavingSoon }))} className={toggleBtn(filters.leavingSoon)}>
          ⏳ Leaving Soon
        </button>
        {activeCount > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs font-mono text-indigo-300 bg-indigo-500/15 border border-indigo-400/30 px-2 py-0.5 rounded-full">
              {activeCount} active
            </span>
            <button
              onClick={() => setFilters({ platforms: [], sources: [], statuses: [], subRisk: false, leavingSoon: false })}
              className="text-xs font-semibold text-gray-400 hover:text-gray-100 underline underline-offset-2"
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
/* Table / cards                                                        */
/* ------------------------------------------------------------------ */

const COLUMNS = [
  { key: "title", label: "Title" },
  { key: "platform", label: "Platform" },
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
  { key: "rating", label: "Rating" },
  { key: "hoursPlayed", label: "Hours" },
  { key: "dateAdded", label: "Added" },
];

function GameTable({ games, sort, setSort, onEdit, onDelete }) {
  const header = (col) => {
    const active = sort.key === col.key;
    return (
      <th key={col.key} className="px-3 py-2.5 text-left">
        <button
          onClick={() => setSort((s) => (s.key === col.key ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: col.key, dir: "asc" }))}
          className={`text-xs font-bold uppercase tracking-wider transition-colors ${active ? "text-indigo-300" : "text-gray-500 hover:text-gray-300"}`}
        >
          {col.label} {active ? (sort.dir === "asc" ? "↑" : "↓") : ""}
        </button>
      </th>
    );
  };

  return (
    <>
      {/* Desktop table */}
      <div className="hidden sm:block bg-gray-900/70 border border-gray-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-800">
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
                  className={`border-b border-gray-800/60 last:border-0 hover:bg-gray-800/50 transition-colors ${
                    g.status === "completed" ? "opacity-60" : ""
                  } ${sub ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-transparent"}`}
                >
                  <td className="px-3 py-2.5 max-w-[280px]">
                    <button onClick={() => onEdit(g)} className="text-gray-100 font-medium hover:text-indigo-300 transition-colors text-left truncate block max-w-full" title={g.title}>
                      {g.title}
                    </button>
                    {g.notes && <div className="text-xs text-gray-500 truncate" title={g.notes}>{g.notes}</div>}
                  </td>
                  <td className="px-3 py-2.5"><PlatformBadge platform={g.platform} /></td>
                  <td className="px-3 py-2.5"><SourceBadge source={g.source} leavingSoon={g.leavingSoon} /></td>
                  <td className="px-3 py-2.5"><StatusBadge status={g.status} /></td>
                  <td className="px-3 py-2.5 font-mono text-gray-300">{g.rating ?? <span className="text-gray-600">—</span>}</td>
                  <td className="px-3 py-2.5 font-mono text-gray-300">{g.hoursPlayed ?? <span className="text-gray-600">—</span>}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-400">{g.dateAdded}</td>
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
              className={`bg-gray-900/70 border border-gray-800 rounded-xl p-3.5 ${sub ? "border-l-4 border-l-amber-400" : ""} ${
                g.status === "completed" ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => onEdit(g)} className="text-gray-100 font-medium text-left leading-snug">
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
      className={`flex flex-wrap items-center gap-2 bg-gray-900/70 border border-gray-800 rounded-xl px-3.5 py-2.5 ${
        isSubDependent(g) ? "border-l-4 border-l-amber-400" : ""
      }`}
    >
      <span className="text-sm font-medium text-gray-100 mr-1">{g.title}</span>
      <PlatformBadge platform={g.platform} />
      <SourceBadge source={g.source} leavingSoon={g.leavingSoon} />
      <StatusBadge status={g.status} />
      <span className="ml-auto flex flex-wrap gap-1.5">{children}</span>
    </div>
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
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [filters, setFilters] = useState({ platforms: [], sources: [], statuses: [], subRisk: false, leavingSoon: false });
  const [sort, setSort] = useState({ key: "dateAdded", dir: "desc" });
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const searchRef = useRef(null);
  const loadedRef = useRef(false);

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
  }, [toast]);

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

  const activeFilterCount =
    filters.platforms.length + filters.sources.length + filters.statuses.length + (filters.subRisk ? 1 : 0) + (filters.leavingSoon ? 1 : 0);

  if (games === null) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500 font-mono text-sm">Loading…</div>;
  }

  const renderQuickActions = (g) => (
    <>
      <QuickActionButton tone="indigo" onClick={() => patchGame(g.id, { source: "purchased", leavingSoon: undefined }, `"${g.title}" marked as purchased.`)}>
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
    <div className="min-h-screen text-gray-100 pb-20">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 pt-6 sm:pt-10">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-3 mb-5 anim-rise">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              GAME<span className="text-indigo-400">VAULT</span>
            </h1>
            <p className="text-xs text-gray-500 mt-1 font-mono">
              {games.length} games · NS1 / NS2 / PS / Steam / Epic / GOG / Prime
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setModal({ type: "io" })}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
            >
              Export / Import
            </button>
            <button
              onClick={() => setModal({ type: "add" })}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-lg shadow-indigo-900/40"
            >
              + Add Game <span className="hidden sm:inline opacity-50 font-mono text-xs ml-1">N</span>
            </button>
          </div>
        </header>

        {/* Quick Check search */}
        <div className="mb-4 anim-rise" style={{ animationDelay: "60ms" }}>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg pointer-events-none">⌕</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quick Check — do I already own this game?  ( / )"
              className="w-full bg-gray-900 border-2 border-gray-700 focus:border-indigo-500 rounded-2xl pl-11 pr-10 py-3.5 text-base text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-colors"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200 p-1"
                title="Clear"
              >
                ✕
              </button>
            )}
          </div>

          {quickMatches !== null && (
            <div className="mt-2.5 anim-rise">
              {quickMatches.length === 0 ? (
                <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-green-300 font-semibold text-sm">
                  ✓ Not in your library — safe to buy.
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                  <p className="text-amber-200 font-semibold text-sm mb-2">
                    Found {quickMatches.length} match{quickMatches.length > 1 ? "es" : ""} in your library:
                  </p>
                  <div className="space-y-1.5">
                    {quickMatches.map((g) => (
                      <div key={g.id} className="flex flex-wrap items-center gap-1.5 text-sm">
                        <button onClick={() => setModal({ type: "edit", game: g })} className="text-gray-100 font-medium hover:text-indigo-300 mr-1">
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
                tab === t.id ? "bg-gray-100 text-gray-950" : "bg-gray-900 text-gray-400 border border-gray-800 hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="space-y-4">
          <div className="anim-rise" style={{ animationDelay: "140ms" }}>
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
              <div className="text-center py-20 bg-gray-900/50 border border-dashed border-gray-700 rounded-2xl">
                <p className="font-display text-xl font-bold text-gray-300 mb-3">Your library is empty</p>
                <p className="text-sm text-gray-500 mb-5">Add your first game to start tracking.</p>
                <button onClick={() => setModal({ type: "add" })} className="px-5 py-2.5 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
                  + Add your first game
                </button>
              </div>
            ) : tab === "psplus" ? (
              <div className="space-y-5">
                {["ps_plus_monthly", "ps_plus_catalog"].map((src) => {
                  const group = visibleGames.filter((g) => g.source === src);
                  return (
                    <section key={src}>
                      <h2 className="font-display text-sm font-bold uppercase tracking-wider text-gray-400 mb-2">
                        {src === "ps_plus_monthly" ? "Monthly (Claimed)" : "Catalog"}{" "}
                        <span className="font-mono text-gray-600">({group.length})</span>
                      </h2>
                      {group.length === 0 ? (
                        <p className="text-sm text-gray-600 italic">None tracked.</p>
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
                  className="inline-block text-sm text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                >
                  Check Taiwan PS Plus Catalog →
                </a>
              </div>
            ) : tab === "prime" ? (
              <div className="space-y-2">
                {visibleGames.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-10">No Prime Gaming Collection games tracked.</p>
                ) : (
                  visibleGames.map((g) => <QuickRow key={g.id} g={g}>{renderQuickActions(g)}</QuickRow>)
                )}
              </div>
            ) : tab === "wishlist" ? (
              <div className="space-y-2">
                {visibleGames.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-10">Wishlist is empty.</p>
                ) : (
                  visibleGames.map((g) => (
                    <QuickRow key={g.id} g={g}>
                      <QuickActionButton
                        tone="indigo"
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
                  <p className="text-sm text-gray-500 text-center py-10">Nothing flagged as leaving soon. 🎉</p>
                ) : (
                  visibleGames.map((g) => <QuickRow key={g.id} g={g}>{renderQuickActions(g)}</QuickRow>)
                )}
              </div>
            ) : visibleGames.length === 0 ? (
              <div className="text-center py-16 bg-gray-900/50 border border-dashed border-gray-700 rounded-2xl">
                <p className="text-gray-400 mb-3">No games match your filters.</p>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => setFilters({ platforms: [], sources: [], statuses: [], subRisk: false, leavingSoon: false })}
                    className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
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
              />
            )}
          </main>
        </div>

        <footer className="mt-10 text-center text-xs text-gray-600 leading-relaxed">
          Data is stored in this browser only (localStorage) — use <strong className="text-gray-500">Export JSON</strong> for backups or to move devices.
          <br />
          Shortcuts: <kbd className="font-mono text-gray-500">N</kbd> add · <kbd className="font-mono text-gray-500">/</kbd> search ·{" "}
          <kbd className="font-mono text-gray-500">Esc</kbd> close
        </footer>
      </div>

      {/* Modals */}
      {modal?.type === "add" && <AddEditModal games={games} onSave={upsertGame} onClose={() => setModal(null)} />}
      {modal?.type === "edit" && <AddEditModal game={modal.game} games={games} onSave={upsertGame} onClose={() => setModal(null)} />}
      {modal?.type === "io" && (
        <ExportImportModal games={games} onClose={() => setModal(null)} onImportParsed={handleImportParsed} onSteamImport={handleSteamImport} toast={toast} />
      )}
      {modal?.type === "delete" && (
        <Modal onClose={() => setModal(null)}>
          <div className="p-6">
            <h2 className="font-display text-lg font-bold text-gray-100 mb-2">Delete game?</h2>
            <p className="text-sm text-gray-400 mb-5">
              "<span className="text-gray-200">{modal.game.title}</span>" ({modal.game.platform}) will be permanently removed.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button onClick={() => deleteGame(modal.game)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors">
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal?.type === "conflict" && (
        <Modal onClose={() => setModal(null)}>
          <div className="p-6">
            <h2 className="font-display text-lg font-bold text-gray-100 mb-2">Import conflict</h2>
            <p className="text-sm text-gray-400 mb-5">
              {modal.conflictCount} game{modal.conflictCount > 1 ? "s" : ""} in this file already exist in your library (same ID).
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => resolveConflict("cancel")} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors">
                Cancel
              </button>
              <button onClick={() => resolveConflict("skip")} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-600 text-gray-200 hover:bg-gray-800 transition-colors">
                Skip Existing
              </button>
              <button onClick={() => resolveConflict("overwrite")} className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
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
            className={`anim-pop block w-full text-left px-4 py-3 rounded-xl text-sm font-medium shadow-xl border backdrop-blur ${
              t.type === "error"
                ? "bg-red-950/90 border-red-500/50 text-red-200"
                : t.type === "success"
                ? "bg-green-950/90 border-green-500/40 text-green-200"
                : "bg-gray-900/95 border-gray-700 text-gray-200"
            }`}
          >
            {t.msg}
          </button>
        ))}
      </div>
    </div>
  );
}
