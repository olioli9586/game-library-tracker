import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sync from "./sync.js";

// In-memory localStorage and a fake GitHub gist API: no real network calls.
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

function gistWith(payload) {
  return {
    id: "gist123",
    updated_at: "2026-09-01T00:00:00Z",
    files: payload === undefined ? {} : { "game_vault.json": { content: typeof payload === "string" ? payload : JSON.stringify(payload) } },
  };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock;
let cloud; // current remote payload

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  cloud = undefined;
  fetchMock = vi.fn(async (url, options = {}) => {
    if (url.endsWith("/gists/gist123") && (!options.method || options.method === "GET")) return jsonResponse(gistWith(cloud));
    if (url.endsWith("/gists/gist123") && options.method === "PATCH") {
      cloud = JSON.parse(JSON.parse(options.body).files["game_vault.json"].content);
      return jsonResponse(gistWith(cloud));
    }
    if (url.endsWith("/gists") && options.method === "POST") {
      cloud = JSON.parse(JSON.parse(options.body).files["game_vault.json"].content);
      return jsonResponse({ id: "gist123" });
    }
    if (url.endsWith("/user")) return jsonResponse({ login: "someone" });
    return jsonResponse({ message: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const game = { id: "g1", title: "Hades", platform: "Steam", source: "purchased", status: "backlog", dateAdded: "2024-01-01" };

describe("credentials", () => {
  it("is configured only with both token and gist id", () => {
    expect(sync.isConfigured()).toBe(false);
    sync.saveCreds("tok", "gist123");
    expect(sync.isConfigured()).toBe(true);
    sync.clearCreds();
    expect(sync.isConfigured()).toBe(false);
    expect(sync.getSeen()).toBe("");
  });
});

describe("pull", () => {
  it("returns parsed data and remembers the cloud version it saw", async () => {
    sync.saveCreds("tok", "gist123");
    cloud = { schema: 1, exportedAt: "2026-09-01T00:00:00.000Z", games: [game], subscriptions: [] };
    const { data } = await sync.pull();
    expect(data.games).toEqual([game]);
    expect(sync.getSeen()).toBe("2026-09-01T00:00:00.000Z");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("returns null data for an empty or corrupt gist", async () => {
    sync.saveCreds("tok", "gist123");
    cloud = "{not json";
    expect((await sync.pull()).data).toBeNull();
    cloud = { games: "nope" };
    expect((await sync.pull()).data).toBeNull();
  });

  it("drops malformed entries from a hand-edited gist", async () => {
    sync.saveCreds("tok", "gist123");
    cloud = { exportedAt: "2026-09-01T00:00:00.000Z", games: [game, null, 7, { id: "x" }], subscriptions: "oops" };
    const { data } = await sync.pull();
    expect(data.games).toEqual([game]);
    expect(data.subscriptions).toEqual([]);
  });

  it("surfaces GitHub error messages", async () => {
    sync.saveCreds("tok", "missing");
    await expect(sync.pull()).rejects.toThrow("GitHub 404: Not Found");
  });
});

describe("push", () => {
  it("writes the library and records what it pushed", async () => {
    sync.saveCreds("tok", "gist123");
    sync.setSeen("2026-09-01T00:00:00.000Z");
    cloud = { schema: 1, exportedAt: "2026-09-01T00:00:00.000Z", games: [], subscriptions: [] };
    const res = await sync.push([game], []);
    expect(res.conflict).toBe(false);
    expect(cloud.games).toEqual([game]);
    expect(sync.getSeen()).toBe(cloud.exportedAt);
    expect(sync.getLastSync()).not.toBe("");
  });

  it("refuses to overwrite a cloud copy another device pushed", async () => {
    sync.saveCreds("tok", "gist123");
    sync.setSeen("2026-09-01T00:00:00.000Z");
    cloud = { schema: 1, exportedAt: "2026-09-02T00:00:00.000Z", games: [game, { ...game, id: "g2" }], subscriptions: [] };
    const res = await sync.push([], []);
    expect(res.conflict).toBe(true);
    expect(res.remote.games).toHaveLength(2);
    expect(cloud.games).toHaveLength(2);
  });

  it("refuses to overwrite a cloud copy this device has never pulled", async () => {
    // e.g. connected to an existing gist but the first pull failed
    sync.saveCreds("tok", "gist123");
    cloud = { schema: 1, exportedAt: "2026-09-02T00:00:00.000Z", games: [game], subscriptions: [] };
    const res = await sync.push([], []);
    expect(res.conflict).toBe(true);
    expect(cloud.games).toEqual([game]);
  });

  it("pushes into a gist that has no library file yet", async () => {
    sync.saveCreds("tok", "gist123");
    const res = await sync.push([game], []);
    expect(res.conflict).toBe(false);
    expect(cloud.games).toEqual([game]);
  });

  it("overwrites when forced", async () => {
    sync.saveCreds("tok", "gist123");
    sync.setSeen("2026-09-01T00:00:00.000Z");
    cloud = { schema: 1, exportedAt: "2026-09-02T00:00:00.000Z", games: [game], subscriptions: [] };
    const res = await sync.push([], [], { force: true });
    expect(res.conflict).toBe(false);
    expect(cloud.games).toEqual([]);
  });
});

describe("hasUnpushedLocalChanges", () => {
  const remote = { schema: 1, exportedAt: "2026-09-01T00:00:00.000Z", games: [game], subscriptions: [] };

  it("is false when local matches the cloud copy", () => {
    expect(sync.hasUnpushedLocalChanges(remote, [game], [], remote.exportedAt)).toBe(false);
  });

  it("is true when local was edited after the last sync and the cloud has not moved", () => {
    expect(sync.hasUnpushedLocalChanges(remote, [game, { ...game, id: "g2" }], [], remote.exportedAt)).toBe(true);
    expect(sync.hasUnpushedLocalChanges(remote, [game], [{ id: "s1", name: "PS Plus", endDate: "2026-12-01", notes: "" }], remote.exportedAt)).toBe(true);
  });

  it("is false when another device pushed since, so the cloud copy wins", () => {
    expect(sync.hasUnpushedLocalChanges(remote, [], [], "2026-08-01T00:00:00.000Z")).toBe(false);
  });

  it("is false when this device has no sync history", () => {
    expect(sync.hasUnpushedLocalChanges(remote, [], [], "")).toBe(false);
    expect(sync.hasUnpushedLocalChanges({ games: [] }, [game], [], "")).toBe(false);
  });

  // pull() records the version it saw, so callers must use the seenBefore it returns
  describe("with the seenBefore returned by pull()", () => {
    it("keeps local edits when the cloud is the copy this device last synced", async () => {
      sync.saveCreds("tok", "gist123");
      sync.setSeen(remote.exportedAt);
      cloud = remote;
      const { data, seenBefore } = await sync.pull();
      expect(sync.hasUnpushedLocalChanges(data, [game, { ...game, id: "g2" }], [], seenBefore)).toBe(true);
    });

    it("lets the cloud win when another device pushed since the last sync", async () => {
      sync.saveCreds("tok", "gist123");
      sync.setSeen("2026-08-01T00:00:00.000Z");
      cloud = remote;
      const { data, seenBefore } = await sync.pull();
      expect(seenBefore).toBe("2026-08-01T00:00:00.000Z");
      expect(sync.getSeen()).toBe(remote.exportedAt);
      expect(sync.hasUnpushedLocalChanges(data, [], [], seenBefore)).toBe(false);
    });
  });
});

describe("createGist", () => {
  it("creates a private gist and marks it as seen", async () => {
    const id = await sync.createGist("tok", [game], []);
    expect(id).toBe("gist123");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.public).toBe(false);
    expect(sync.getSeen()).toBe(cloud.exportedAt);
  });
});

describe("maskToken", () => {
  it("hides all but the edges of a token", () => {
    expect(sync.maskToken("")).toBe("");
    expect(sync.maskToken("short")).toBe("•••••");
    expect(sync.maskToken("ghp_abcdefgh1234")).toBe("ghp_••••••••1234");
  });
});

describe("relativeTime", () => {
  it("formats elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    expect(sync.relativeTime("")).toBe("never");
    expect(sync.relativeTime("2026-09-25T11:59:30Z")).toBe("30s ago");
    expect(sync.relativeTime("2026-09-25T11:30:00Z")).toBe("30m ago");
    expect(sync.relativeTime("2026-09-25T09:00:00Z")).toBe("3h ago");
    expect(sync.relativeTime("2026-09-22T12:00:00Z")).toBe("3d ago");
    vi.useRealTimers();
  });
});
