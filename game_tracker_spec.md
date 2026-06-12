# Game Library Tracker — Product Spec (v2)

## Changelog from v1

- Added `prime_gaming_catalog` source type (games accessible while Prime subscribed, not permanently owned)
- Added API / auto-import guidance with realistic per-platform assessment
- Elevated search to a primary "Quick Check" feature, not just a filter
- Added `leavingSoon` flag to data model; added PS Plus Taiwan region guidance for catalog tracking
- Split NS into NS1 and NS2 as separate platforms (NS2 exclusives + upgrade editions make this necessary)
- Updated Section 12 (model prompt) to cover all of the above

---

## 1. Overview

A personal multi-platform game library tracker. The core problems it solves:

1. **Prevent re-buying**: Quick Check search before purchase — type a title and instantly see if it already exists in any platform
2. **Subscription risk visibility**: Distinguish permanently owned games from subscription-dependent ones
3. **PS Plus complexity**: Monthly claimed games, catalog games, and "leaving soon" flags are tracked separately
4. **Backlog management**: Track play status across all platforms in one place

### Platforms in Scope

| ID | Platform | Notes |
|----|----------|-------|
| NS1 | Nintendo Switch 1 | Original / Lite / OLED |
| NS2 | Nintendo Switch 2 | Separate category; see Section 6 |
| PS4 | PlayStation 4 | |
| PS5 | PlayStation 5 | |
| Steam | Steam (PC) | |
| Epic | Epic Games Store (PC) | |
| GOG | GOG (PC) | |
| Prime | Prime Gaming (Amazon) | For claimed (permanent) games |

---

## 2. Ownership Source Types

The most critical part of the data model. Two entries with the same title can have very different ownership status.

| Source ID | Label | Description | Permanent Access? |
|-----------|-------|-------------|-------------------|
| `purchased` | Purchased | Bought digitally or physically | Yes |
| `ps_plus_monthly` | PS Plus Monthly | Claimed monthly free game (Essential tier). Requires active PS Plus to download/play. NOT permanently owned. | No |
| `ps_plus_catalog` | PS Plus Catalog | Available in Extra/Premium tier. Not claimed — streaming-only while subscribed. Lost immediately if sub lapses. | No |
| `epic_free` | Epic Free | Claimed during Epic's weekly free window. Permanently owned once claimed, even if you cancel Epic account. | Yes |
| `prime_gaming` | Prime Gaming (Claimed) | Claimed via Amazon Prime — delivered as a GOG, Epic, or standalone key. Permanently owned once claimed. Prime membership no longer needed. | Yes |
| `prime_gaming_catalog` | Prime Gaming Collection | Games accessible while Prime subscribed via the Amazon Games app. NOT permanently owned — lost if Prime lapses. | No |
| `physical` | Physical | Cartridge or disc. Relevant for NS1, NS2, PS4, PS5. | Yes |

### Key Derived Rules

- **Subscription-dependent**: `ps_plus_monthly`, `ps_plus_catalog`, `prime_gaming_catalog`
- **Permanently owned**: `purchased`, `epic_free`, `prime_gaming`, `physical`
- For `prime_gaming` entries, record the delivery platform in `notes` (e.g., "Redeemed on GOG")

---

## 3. Data Model

```typescript
type Platform = "NS1" | "NS2" | "PS4" | "PS5" | "Steam" | "Epic" | "GOG" | "Prime";

type Source =
  | "purchased"
  | "ps_plus_monthly"
  | "ps_plus_catalog"
  | "epic_free"
  | "prime_gaming"
  | "prime_gaming_catalog"
  | "physical";

type Status = "wishlist" | "backlog" | "playing" | "completed" | "dropped" | "on_hold";

interface Game {
  id: string;               // crypto.randomUUID()
  title: string;            // required
  platform: Platform;       // required
  source: Source;           // required
  status: Status;           // required, default: "backlog"
  rating?: number;          // 1–10, optional
  hoursPlayed?: number;     // optional
  notes?: string;           // free text, optional
  dateAdded: string;        // ISO 8601, auto-set on creation
  completedDate?: string;   // ISO 8601, set when status changes to "completed"
  leavingSoon?: boolean;    // manually flagged when PS Plus / Prime catalog announces removal
}
```

### Derived Properties (not stored)

```typescript
const isSubscriptionDependent = (g: Game) =>
  ["ps_plus_monthly", "ps_plus_catalog", "prime_gaming_catalog"].includes(g.source);

const isPermanentlyOwned = (g: Game) => !isSubscriptionDependent(g);

const isAtRisk = (g: Game) => isSubscriptionDependent(g) || g.leavingSoon === true;
```

---

## 4. API and Auto-Import (Per Platform)

No single tool auto-imports every platform. Here is the realistic per-platform assessment.

### Steam (Feasible — recommended to implement)

Steam has a stable, public, documented API.

- **Endpoint**: `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key={API_KEY}&steamid={STEAM_ID}&include_appinfo=1&format=json`
- **Requirements**: Free Steam Web API key from `steamcommunity.com/dev/apikey`; Steam profile must be set to public
- **Returns**: Full owned game list with name and playtime in minutes

**Implementation approach for a client-only React app (no backend):**
Steam's API requires CORS headers that Steam does not send for browser requests. Direct `fetch()` from the app will fail. Two options:

Option A (simplest): User visits the API URL directly in their browser, copies the JSON response, and pastes it into the tracker's "Import from Steam" dialog. The tracker parses it and bulk-adds games as `source: purchased` on `Steam`.

Option B (better UX): Build a lightweight proxy endpoint (Node.js / Cloudflare Worker) that accepts the user's Steam ID + API key and returns the library. The tracker calls the proxy.

**Why the user's previous attempt may have failed**: If using `fetch()` directly in a browser to the Steam API, CORS blocks it. This is not an auth problem — it is a browser security limitation. Server-side calls work fine.

### PlayStation / PSN (Limited — not recommended for MVP)

Sony has no official public API. The `psn-api` npm library (unofficial) uses reverse-engineered OAuth endpoints.

- It can fetch trophies and recently played games, but **cannot reliably return a complete library list**
- PS Plus Catalog games do **not** appear as "owned" — they appear under a different endpoint that is even less stable
- Sony breaks these endpoints occasionally with no notice
- Taiwan PSN (台灣 PSN): same auth flow as other regions; the library and catalog differ from NA/EU — users should check `store.playstation.com/zh-tw-HK` for the Taiwan-region PS Plus catalog

**Recommendation**: manual entry for PlayStation in MVP. Add a note in the UI that says "PlayStation auto-import is not available — Sony does not provide a public API."

### Epic Games (Not feasible)

Epic has no stable public API for library access. Internal GraphQL endpoints require auth cookies and break without warning. Manual entry only.

### GOG (Not feasible for MVP)

GOG has an unofficial `embed.gog.com/account/getFilteredProducts` endpoint that requires OAuth login cookies. Fragile and not officially supported. Manual entry only.

### Prime Gaming (Not feasible)

No API. Claimed games are distributed to GOG, Epic, or standalone launchers — they do not stay in one place. Manual entry only.

### Nintendo Switch 1 / Switch 2 (No API — will always be manual)

Nintendo exposes no library API at all. Manual entry is the only option regardless of what tool is used.

---

## 5. Core Functional Requirements

### 5.1 Quick Check Search (PRIMARY FEATURE — top priority in UI)

This is the main daily-use feature. Before buying a game, the user needs a fast answer: "Do I already own this anywhere?"

- A large, always-visible search bar at the top of every view (not hidden in a filter panel)
- Searches across title, notes, and platform simultaneously
- Results appear instantly as the user types (no submit button needed)
- Each result card shows: title, platform badge, source badge, status badge
- If no results: display "Not in your library" in green — this is the answer they need
- If one or more results: show them clearly — "Found on PS5 (PS Plus Monthly)" is the answer

The search field should also be pre-focused when the user opens the app on desktop.

### 5.2 Game Management (CRUD)

- **Add game**: Modal form. Required: title, platform, source, status. Optional: rating, hours, notes, leavingSoon flag.
- **Edit game**: Opens same modal pre-populated. All fields editable.
- **Delete game**: Requires confirmation. Single game only in MVP.
- **Duplicate warning on add**: Fuzzy-match the title against existing library as user types. If a match exists on any platform, show a non-blocking inline warning: "You may already have [Title] on [Platform] ([Source]). Still adding?"

### 5.3 Library View

Default view is a table. Toggle between table and card/grid.

**Table columns:**
1. Title (sortable; click to open edit modal)
2. Platform (color-coded badge)
3. Source (badge; subscription-dependent ones have an amber indicator)
4. Status (badge)
5. Leaving Soon (warning icon if `leavingSoon: true`)
6. Rating (optional)
7. Hours Played (optional)
8. Date Added (sortable)
9. Actions (edit, delete)

**Row styling:**
- Subscription-dependent: amber/yellow left border
- `leavingSoon: true`: additional red "!" badge in the Source column
- Completed: slightly dimmed/muted

### 5.4 Filtering

All filters are AND across types, OR within a multi-select.

| Filter | Type |
|--------|------|
| Search | Text input, always visible |
| Platform | Multi-select chips |
| Source | Multi-select chips |
| Status | Multi-select chips |
| Leaving Soon | Toggle |
| Subscription Risk | Toggle (shows all subscription-dependent games) |

Active filter count badge + "Clear all" button always visible when filters are applied.

### 5.5 Dashboard / Stats Panel

Collapsible panel showing:

- Total game count
- By status (pie/bar): Backlog / Playing / Completed / Dropped / On Hold / Wishlist
- By platform (horizontal bar)
- Subscription risk count: "X games at risk if subscriptions lapse"
- "Leaving Soon" count: "X games flagged as leaving soon"
- Completion rate: completed / (all non-wishlist games)

### 5.6 PS Plus Maintenance View

A dedicated tab/quick-view (not just a filter shortcut):

- Lists all `ps_plus_monthly` and `ps_plus_catalog` games, grouped by source type
- Shows `leavingSoon` flag prominently
- Each row has:
  - "Mark Purchased" quick action (changes source to `purchased` when user buys a catalog game)
  - "Leaving Soon" toggle (sets `leavingSoon: true`)
  - "Remove" action for games that have left the catalog
- Taiwan PS Plus catalog reference link: `store.playstation.com/zh-tw-HK/pages/ps-plus` (opens in new tab)

### 5.7 Wishlist View

A dedicated tab showing all games with `status: wishlist`:

- Useful for tracking upcoming games before purchase
- Each row shows platform, intended source (what the user plans to buy it as), and notes
- "Mark Purchased" quick action: changes status to `backlog` and source to `purchased`

### 5.8 Export / Import

- **Export JSON**: Full library as JSON array. Filename: `game_library_YYYY-MM-DD.json`
- **Export CSV**: All fields. For spreadsheet use.
- **Import JSON**: Upload previously exported file. On conflict (same ID): prompt Overwrite / Skip / Cancel.
- **Import from Steam (JSON paste)**: Dedicated dialog where user pastes Steam API JSON response. Parser maps Steam data to tracker entries as `source: purchased`, `platform: Steam`, `status: backlog`, `hoursPlayed` from Steam's `playtime_forever` (minutes converted to hours).

---

## 6. NS1 vs NS2: Keep as Separate Platforms

**Recommendation: Separate (NS1 and NS2 are distinct platform IDs)**

Reasons:
1. NS2-exclusive games exist and will increase over time
2. Some NS1 games have paid "Nintendo Switch 2 Edition" upgrades (e.g., a user owns TOTK on NS1 but separately purchases the NS2 Edition) — these should be trackable as two entries
3. Some NS1 games received free performance updates on NS2 but remain NS1 entries — notes field handles this
4. A user with both consoles might be playing an NS1 game on NS2 hardware; that is still an NS1 game entry
5. Backward compatibility is not 100% — a small number of NS1 games cannot run on NS2. The tracker can surface this if a user has NS2 only.

**How to handle NS1 games played on NS2 hardware**: the platform field tracks which version of the game you own, not which hardware you run it on. An NS1 game played on NS2 hardware is still `platform: NS1`.

---

## 7. UI and UX Requirements

### Theme

Dark theme as default. Light theme toggle optional.

**Platform badge colors:**

| Platform | Color |
|----------|-------|
| NS1 | Red `#E60012` |
| NS2 | Dark Red `#8B0000` (or a secondary Nintendo red to distinguish from NS1) |
| PS4 | Blue `#003791` |
| PS5 | Blue `#003791` with subtle PS5 logo |
| Steam | Steel Blue `#1B2838` |
| Epic | Dark `#2D2D2D` |
| GOG | Purple `#5C2D8F` |
| Prime | Amazon Orange `#FF9900` |

**Source badge color logic:**

- Permanently owned sources: neutral/green tint
- Subscription-dependent sources: amber/yellow tint
- `leavingSoon: true`: red badge or warning icon added to row

### Interaction

- `N` key anywhere: opens "Add Game" modal
- `Escape`: closes any open modal
- `/` key: focuses the search bar
- All modals should trap focus and be accessible
- Confirmation dialogs before delete or bulk actions

### Responsiveness

- Mobile-first. Table collapses to cards on screen < 640px.
- On mobile, card shows: title, platform badge, source badge, status badge, action buttons.
- Stats panel collapses to a single summary line on mobile.

---

## 8. Persistence

Use the Claude artifact persistent storage API:

```javascript
// Save
await window.storage.set('game_library_v2', JSON.stringify(games));

// Load
try {
  const result = await window.storage.get('game_library_v2');
  const games = result ? JSON.parse(result.value) : [];
} catch {
  // Key not found — first run, use sample data
}
```

Use `game_library_v2` as the key (versioned to avoid conflicts with old schema).

---

## 9. Component Structure

```
App
├── QuickCheckSearchBar (always visible at top, full width)
├── TabBar: All | PS Plus | Wishlist | Leaving Soon
├── StatsPanel (collapsible)
├── FilterBar
│   ├── PlatformFilter (multi-select chips)
│   ├── SourceFilter (multi-select chips)
│   ├── StatusFilter (multi-select chips)
│   ├── ToggleSubscriptionRisk
│   ├── ToggleLeavingSoon
│   └── SortSelector + ActiveFilterBadge
├── GameTable (or GameCardGrid)
│   ├── GameRow / GameCard (per game)
│   └── EmptyState
├── PSPlusMaintenanceView (dedicated tab)
├── WishlistView (dedicated tab)
├── AddEditGameModal
│   ├── TitleInput (with duplicate detection warning)
│   ├── PlatformSelect
│   ├── SourceSelect (source options filtered by platform: NS1/NS2 show physical, etc.)
│   ├── StatusSelect
│   ├── LeavingSoonToggle (shown only if source is subscription-dependent)
│   ├── RatingInput
│   ├── HoursInput
│   └── NotesTextarea
├── DeleteConfirmModal
└── ExportImportPanel
    ├── ExportJSON / ExportCSV buttons
    ├── ImportJSON file upload
    └── ImportSteamDialog (paste Steam API JSON)
```

---

## 10. Edge Cases

| Scenario | Handling |
|----------|----------|
| Same game on NS1 and NS2 (e.g., bought original, then NS2 Edition) | Two separate entries. Duplicate warning fires but user can proceed. |
| NS1 game with free NS2 performance update | Single NS1 entry; add note "Free NS2 performance update applied" |
| PS Plus Monthly game later purchased | Edit source from `ps_plus_monthly` to `purchased`. `leavingSoon` auto-clears. |
| PS Plus Catalog game removed by Sony | User opens PS Plus view, finds entry, either deletes it or converts to purchased. |
| Prime Gaming catalog game lost when Prime lapses | Same flow as PS Plus Catalog removal above. |
| Prime Gaming claimed game — which platform? | Set platform to where key was redeemed (GOG, Epic, etc.), source: `prime_gaming`, note: "From Prime Gaming" |
| Steam import: game already in library | On parse, check title match. Flag as "already exists" and allow skip. |
| Steam import: playtime 0 minutes | Set `hoursPlayed` to 0 or omit — do not block import. |
| Taiwan PS Plus catalog differs from NA | The `leavingSoon` flag and the PS Plus Maintenance view reference the Taiwan catalog link. No automation possible. |
| Long title on mobile | Truncate in card/table view. Full title in modal. |
| Rating cleared after being set | Allow `undefined`. Do not store 0 as a proxy for "no rating." |

---

## 11. Sample Data (Initial State / Testing)

Load this if `window.storage` key is not found on first run.

```json
[
  {
    "id": "a1b2c3d4-0001",
    "title": "The Legend of Zelda: Tears of the Kingdom",
    "platform": "NS1",
    "source": "purchased",
    "status": "completed",
    "rating": 10,
    "hoursPlayed": 87,
    "notes": "",
    "dateAdded": "2023-05-12"
  },
  {
    "id": "a1b2c3d4-0002",
    "title": "Hollow Knight",
    "platform": "NS1",
    "source": "purchased",
    "status": "on_hold",
    "rating": 8,
    "hoursPlayed": 12,
    "dateAdded": "2024-01-05"
  },
  {
    "id": "a1b2c3d4-0003",
    "title": "God of War Ragnarok",
    "platform": "PS5",
    "source": "ps_plus_monthly",
    "status": "backlog",
    "dateAdded": "2024-03-01"
  },
  {
    "id": "a1b2c3d4-0004",
    "title": "Death Stranding",
    "platform": "PS5",
    "source": "ps_plus_catalog",
    "status": "playing",
    "hoursPlayed": 6,
    "leavingSoon": true,
    "dateAdded": "2024-11-15"
  },
  {
    "id": "a1b2c3d4-0005",
    "title": "Cyberpunk 2077",
    "platform": "Steam",
    "source": "purchased",
    "status": "completed",
    "rating": 9,
    "hoursPlayed": 110,
    "dateAdded": "2022-08-20"
  },
  {
    "id": "a1b2c3d4-0006",
    "title": "Control",
    "platform": "GOG",
    "source": "prime_gaming",
    "status": "backlog",
    "notes": "Claimed via Prime Gaming, redeemed on GOG",
    "dateAdded": "2024-02-14"
  },
  {
    "id": "a1b2c3d4-0007",
    "title": "Dead Island 2",
    "platform": "Prime",
    "source": "prime_gaming_catalog",
    "status": "backlog",
    "leavingSoon": false,
    "notes": "Available via Prime Gaming Collection in Amazon Games app",
    "dateAdded": "2025-01-10"
  },
  {
    "id": "a1b2c3d4-0008",
    "title": "Mario Kart World",
    "platform": "NS2",
    "source": "purchased",
    "status": "playing",
    "hoursPlayed": 14,
    "rating": 9,
    "dateAdded": "2025-06-05"
  }
]
```

---

## 12. Prompt for Claude Fable 5

Build a complete, production-quality personal game library tracker as a single-file React `.jsx` artifact. The full specification is in Sections 1–11 above. This section summarises every requirement you must implement.

---

### Tech Stack

- **React** with hooks only: `useState`, `useMemo`, `useEffect`, `useCallback`
- **Tailwind CSS** utility classes for all styling — dark theme by default, no custom CSS
- **`crypto.randomUUID()`** for ID generation — no external libraries
- **`window.storage`** for persistence (Claude artifact storage API):
  - Save: `await window.storage.set('game_library_v2', JSON.stringify(games))`
  - Load: wrap `await window.storage.get('game_library_v2')` in try/catch; key absence throws an error
- Single `.jsx` file — no backend, no external API calls, no localStorage

---

### Data Model

```typescript
type Platform = "NS1" | "NS2" | "PS4" | "PS5" | "Steam" | "Epic" | "GOG" | "Prime";
type Source = "purchased" | "ps_plus_monthly" | "ps_plus_catalog" | "epic_free" | "prime_gaming" | "prime_gaming_catalog" | "physical";
type Status = "wishlist" | "backlog" | "playing" | "completed" | "dropped" | "on_hold";

interface Game {
  id: string;
  title: string;
  platform: Platform;
  source: Source;
  status: Status;
  rating?: number;        // 1–10
  hoursPlayed?: number;
  notes?: string;
  dateAdded: string;      // ISO 8601
  completedDate?: string;
  leavingSoon?: boolean;
}
```

Derived helpers:
```typescript
const isSubDependent = (g) => ["ps_plus_monthly","ps_plus_catalog","prime_gaming_catalog"].includes(g.source);
const isAtRisk = (g) => isSubDependent(g) || g.leavingSoon;
```

---

### Features — implement all of the following

**1. Quick Check search bar**
Always visible at the very top of the app, full width. Searches across `title` and `notes` simultaneously as the user types (no submit button). When the query matches zero entries, display a prominent green banner: "Not in your library — safe to buy." When it matches entries, list them with platform and source badges so the user knows where they already own it.

**2. CRUD — Add / Edit / Delete**
- Add and Edit share the same modal form. Required fields: title, platform, source, status. Optional: rating (1–10 number input), hoursPlayed, notes.
- Show the `leavingSoon` toggle only when the selected source is subscription-dependent (`ps_plus_monthly`, `ps_plus_catalog`, `prime_gaming_catalog`).
- On the Add form, as the user types the title, fuzzy-match against existing entries. If a close match exists on any platform, show a non-blocking inline warning below the title field: "Possible duplicate: [Title] on [Platform] ([Source])."
- Delete requires a confirmation dialog. Clicking outside the modal or pressing Escape cancels without saving.

**3. Library table**
- Sortable columns: Title, Platform, Source, Status, Rating, Hours Played, Date Added.
- Platform and Source rendered as small color-coded badges (see badge colors below).
- Rows where `isSubDependent` is true get a 3px amber left border.
- Rows where `leavingSoon` is true get an additional red "!" warning chip next to the source badge.
- Clicking a game title opens the Edit modal for that entry.
- On screens narrower than 640px, collapse the table to cards showing: title, platform badge, source badge, status badge, action buttons (edit, delete).

**4. Tab bar — quick views**
Tabs at the top (below the search bar): All | PS Plus | Prime Catalog | Wishlist | Leaving Soon.
- **All**: shows every entry, respects filter bar settings.
- **PS Plus**: filters to `source: ps_plus_monthly` or `ps_plus_catalog`. Groups results under two headings: "Monthly (Claimed)" and "Catalog." Each row has two quick-action buttons: "Mark Purchased" (sets source to `purchased`, clears `leavingSoon`) and "Leaving Soon" toggle (sets `leavingSoon: true/false`). Show a link at the bottom of this view: "Check Taiwan PS Plus Catalog →" pointing to `https://store.playstation.com/zh-tw-HK/pages/ps-plus`.
- **Prime Catalog**: filters to `source: prime_gaming_catalog`. Same quick-action buttons as PS Plus view.
- **Wishlist**: filters to `status: wishlist`. Each row has a "Mark Purchased" quick action that sets `status: backlog` and `source: purchased`.
- **Leaving Soon**: filters to `leavingSoon: true`. Shows only at-risk subscription games flagged by the user.

**5. Filter bar**
Available when the "All" tab is active. Contains:
- Multi-select chip selectors for Platform, Source, and Status (all three).
- Toggle: "Subscription Risk" — shows only subscription-dependent entries.
- Toggle: "Leaving Soon" — shows only `leavingSoon: true` entries.
- Active filter count badge (e.g., "3 active") + "Clear All" button that resets every filter.

**6. Stats panel**
Collapsible panel, collapsed by default on mobile. Shows:
- Total game count in library.
- Breakdown by status as a horizontal bar chart or labelled number row.
- Breakdown by platform as a horizontal bar chart.
- Count of subscription-dependent games: "X games lost if subscriptions lapse."
- Count of `leavingSoon` entries: "X games flagged as leaving soon."

**7. Export / Import (settings or menu button)**
- **Export JSON**: download the full games array as `game_library_YYYY-MM-DD.json`.
- **Export CSV**: all fields as CSV, one game per row.
- **Import JSON**: file upload. On conflict (same `id` already in library): prompt user "X games already exist — Overwrite / Skip / Cancel."
- **Steam JSON paste import**: a textarea where the user pastes the raw JSON from `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/`. Parse `response.games[]`, map `name` → title, `playtime_forever` (minutes) → hoursPlayed (divide by 60, round to 1 decimal), create each entry as `platform: "Steam"`, `source: "purchased"`, `status: "backlog"`, `dateAdded: today`. Skip entries whose title already exists in the library (case-insensitive). Show a summary after import: "X games added, Y skipped (already in library)."

**8. Keyboard shortcuts**
- `N` anywhere: opens Add modal.
- `/` anywhere: focuses the Quick Check search bar.
- `Escape`: closes any open modal or panel.

**9. Empty states**
- Empty library on first load: large centered prompt "Your library is empty — add your first game" with a button that opens the Add modal.
- Filtered view with zero results: "No games match your filters." with a "Clear Filters" button.
- Quick Check with no matches: green banner "Not in your library."

**10. Persistence on every change**
On component mount, load from `window.storage.get('game_library_v2')`. If the key is not found (first run), seed the library with the sample data in Section 11. On every mutation to the games array (add, edit, delete, quick-action), immediately persist with `window.storage.set('game_library_v2', JSON.stringify(updatedGames))`. Wrap all storage calls in try/catch and surface errors to the user as a dismissible toast.

**11. Edge cases to handle**
- Same title entered on a second platform: allow it, show duplicate warning, but do not block.
- `leavingSoon` auto-clears to `false` when source is changed to a non-subscription type.
- `completedDate` is set automatically to today's ISO date when status is changed to `completed`; it is cleared when status changes away from `completed`.
- Rating stored as `undefined` when cleared — never store `0` as a proxy for "no rating."
- Steam import: entries with `playtime_forever: 0` are valid — import them with `hoursPlayed` omitted.

---

### Visual Design

**Dark theme color palette (Tailwind):**
- App background: `bg-gray-950`
- Card / panel background: `bg-gray-900`
- Table row: `bg-gray-900`, hover `bg-gray-800`
- Border: `border-gray-700`
- Primary text: `text-gray-100`
- Muted text: `text-gray-400`
- Accent / button: `bg-indigo-600` hover `bg-indigo-500`
- Success / green: `text-green-400`
- Warning / amber: `text-amber-400`, amber left border `border-l-4 border-amber-400`
- Danger / red: `text-red-400`

**Platform badge background colors:**
| Platform | Hex |
|----------|-----|
| NS1 | `#E60012` |
| NS2 | `#8B0000` |
| PS4 | `#003088` |
| PS5 | `#003088` |
| Steam | `#1B2838` |
| Epic | `#3D3D3D` |
| GOG | `#5C2D8F` |
| Prime | `#FF9900` |

All badges use white text. Use `text-xs font-semibold px-2 py-0.5 rounded-full` for badge sizing.

---

### Do Not Implement

PSN auto-import, Epic auto-import, GOG auto-import, Nintendo auto-import, user accounts, cloud sync, price tracking, achievement or trophy tracking, social features, multi-user support.
