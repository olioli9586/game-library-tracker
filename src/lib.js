/* Pure data helpers shared by the UI. Kept free of React so they can be unit-tested. */

export const PLATFORMS = ["NS1", "NS2", "PS4", "PS5", "Steam", "Epic", "GOG", "Prime"];

export const SOURCES = {
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

export const STATUSES = {
  wishlist: { label: "Wishlist", cls: "bg-dusk/10 text-dusk border-dusk/30" },
  backlog: { label: "Backlog", cls: "bg-fade/10 text-fade border-fade/30" },
  playing: { label: "Playing", cls: "bg-pine/10 text-pine border-pine/30" },
  completed: { label: "Completed", cls: "bg-sage/10 text-sage border-sage/30" },
  dropped: { label: "Dropped", cls: "bg-clay/10 text-clay border-clay/30" },
  on_hold: { label: "On Hold", cls: "bg-honey/10 text-honey border-honey/30" },
};

export const SUB_SOURCES = ["ps_plus_monthly", "ps_plus_catalog", "prime_gaming_catalog", "nintendo_online", "game_pass"];
export const isSubDependent = (g) => SUB_SOURCES.includes(g.source);

// Local calendar date as YYYY-MM-DD. toISOString() would give the UTC date,
// which is a day behind for the morning hours east of UTC (e.g. UTC+8).
export const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayISO = () => localISO(new Date());
// Letters and digits of any script, case- and accent-folded: "Pokémon" ~ "pokemon",
// full-width "ＦＦ" ~ "ff", and kana / hangul titles are kept rather than erased.
// Only Latin-style accents are dropped; kana voicing marks are recomposed so that
// "ガンダム" does not match "カンダム".
export const norm = (s) =>
  (s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
export const fuzzyMatch = (a, b) => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
};

// Quick Check / search: title fuzzy match, or the query appearing in the notes.
export function matchesQuery(game, query) {
  const q = norm(query);
  if (!q) return false;
  return fuzzyMatch(game.title, query) || norm(game.notes).includes(q);
}

export function sourcesForPlatform(platform, current) {
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

export function parsePastedTitles(text) {
  const out = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    let s = raw.replace(/^[\s•·\-–—*>]+/, "").replace(/[\s|]+$/, "").trim();
    if (s.length < 2) continue;
    // Skip lines that are just prices, numbers, or dates (store pages are full of them)
    if (/^(NT\$|HK\$|US\$|\$|¥|€|£|USD|TWD|HKD)?\s*[\d,.]+\s*(元|USD|TWD|HKD)?$/i.test(s)) continue;
    if (/^\d{4}[/.\-年]\s?\d{1,2}[/.\-月]\s?\d{1,2}\s?日?$/.test(s)) continue;
    if (/^(free|included|purchased|owned|installed|download|已購買|已擁有|免費)$/i.test(s)) continue;
    if (/^(PS3|PS4|PS5|PS VR2?|PC|Mac|Nintendo Switch( 2)?|Full game|Game|Add-on|Bundle|Demo|Your Library|Library|Sort by|Filter)$/i.test(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export const csvEscape = (v) => {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_COLUMNS = ["id", "title", "platform", "source", "status", "rating", "hoursPlayed", "notes", "dateAdded", "completedDate", "leavingSoon"];

// UTF-8 BOM first so Excel reads CJK titles as UTF-8 instead of the system code page.
export function gamesToCSV(games) {
  const rows = [CSV_COLUMNS.join(",")];
  for (const g of games) rows.push(CSV_COLUMNS.map((c) => csvEscape(g[c])).join(","));
  return "\uFEFF" + rows.join("\r\n");
}

export function daysBetween(endISO) {
  const end = new Date(endISO + "T23:59:59");
  const now = new Date();
  return Math.floor((end - now) / (1000 * 60 * 60 * 24));
}

// Extend an end date by N months, starting from today if it already lapsed.
// Month-end dates clamp (Jan 31 + 1 month = Feb 28/29) instead of rolling over.
export function addMonths(isoDate, months) {
  const base = new Date(isoDate + "T12:00:00");
  if (Number.isNaN(base.getTime())) return isoDate;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = base < today ? today : base;
  const y = start.getFullYear();
  const m = start.getMonth() + months;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return localISO(new Date(y, m, Math.min(start.getDate(), lastDay), 12));
}

export function sanitizeSub(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.name || !raw.endDate) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    name: String(raw.name),
    endDate: String(raw.endDate).slice(0, 10),
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

export function sanitizeGame(raw) {
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

// Map a Steam GetOwnedGames `games` list to new library entries. Only titles
// already tracked on Steam are skipped: owning a game on another platform is
// a separate copy and should still be recorded.
export function planSteamImport(list, games) {
  const existing = new Set(games.filter((g) => g.platform === "Steam").map((g) => g.title.toLowerCase()));
  const added = [];
  let skipped = 0;
  for (const item of list) {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
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
  return { added, skipped };
}

// Global keyboard shortcuts: Esc closes, "/" focuses search, N adds a game.
// Browser/OS combos (Ctrl/Cmd/Alt+N = new window) and typing in fields are left alone.
export function shortcutAction(e) {
  if (e.key === "Escape") return "close";
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const t = e.target;
  const tag = t?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return null;
  if (e.key === "/") return "search";
  if (e.key === "n" || e.key === "N") return "add";
  return null;
}
