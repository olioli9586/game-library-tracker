# Game Vault — Game Library Tracker

A personal multi-platform game library tracker. Tracks what you own across NS1, NS2, PS4, PS5, Steam, Epic, GOG, and Prime Gaming — and, critically, *how* you own it (purchased vs. subscription-dependent).

Built from `game_tracker_spec.md`.

## Features

- **Quick Check search** — type a title before buying; instantly see "Not in your library — safe to buy" or where you already own it
- **Subscription risk tracking** — PS Plus Monthly/Catalog and Prime Collection games are visually flagged (amber border); "Leaving Soon" warnings
- **Tabs** — All / PS Plus / Prime Catalog / Wishlist / Leaving Soon, with quick actions (Mark Purchased, Leaving Soon toggle)
- **Filters & sorting** — platform / source / status chips, risk toggles, sortable table
- **Stats panel** — status & platform breakdowns, at-risk counts, completion rate
- **Export / Import** — JSON backup & restore (with conflict resolution), CSV export, Steam library import via JSON paste
- **Keyboard shortcuts** — `N` add game, `/` focus search, `Esc` close
- Mobile responsive (table collapses to cards)

## Data & privacy

All data is stored in your browser's `localStorage` — nothing is sent to any server. Use **Export JSON** for backups or to move between devices/browsers.

## Development

```bash
npm install
npm run dev
```

## Deployment

Pushes to `main` auto-deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Steam import

1. Get a free API key: https://steamcommunity.com/dev/apikey
2. Set your Steam profile to public
3. Open in your browser:
   `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=YOUR_KEY&steamid=YOUR_ID&include_appinfo=1&format=json`
4. Copy the JSON and paste it into **Export / Import → Import from Steam**

(Direct in-app fetch is impossible: Steam's API does not send CORS headers.)

PlayStation, Epic, GOG, Prime, and Nintendo have no public library APIs — manual entry only.
