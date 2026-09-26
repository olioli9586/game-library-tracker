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
export const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9一-鿿]/g, "");
export const fuzzyMatch = (a, b) => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
};

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
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

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
