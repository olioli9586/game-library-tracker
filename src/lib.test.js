import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  addMonths,
  todayISO,
  csvEscape,
  daysBetween,
  fuzzyMatch,
  gamesToCSV,
  isSubDependent,
  matchesQuery,
  parsePastedTitles,
  planSteamImport,
  sanitizeGame,
  sanitizeSub,
  sourcesForPlatform,
} from "./lib.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("fuzzyMatch", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(fuzzyMatch("The Legend of Zelda: Tears of the Kingdom", "zelda tears")).toBe(true);
    expect(fuzzyMatch("The Legend of Zelda: Tears of the Kingdom", "zelda kingdom")).toBe(false);
    expect(fuzzyMatch("The Legend of Zelda: Tears of the Kingdom", "tears of the kingdom")).toBe(true);
    expect(fuzzyMatch("Hollow Knight", "hollow-knight")).toBe(true);
  });

  it("matches in either direction", () => {
    expect(fuzzyMatch("Control", "Control Ultimate Edition")).toBe(true);
    expect(fuzzyMatch("Control Ultimate Edition", "Control")).toBe(true);
  });

  it("matches Chinese titles", () => {
    expect(fuzzyMatch("薩爾達傳說 王國之淚", "王國之淚")).toBe(true);
  });

  it("matches Japanese and Korean titles", () => {
    expect(fuzzyMatch("ゼルダの伝説 ティアーズ オブ ザ キングダム", "ゼルダの伝説")).toBe(true);
    expect(fuzzyMatch("ドラゴンクエストXI", "ファイナルファンタジー")).toBe(false);
    expect(fuzzyMatch("젤다의 전설", "젤다")).toBe(true);
  });

  it("ignores accents and full-width characters", () => {
    expect(fuzzyMatch("Pokémon Legends: Z-A", "pokemon legends")).toBe(true);
    expect(fuzzyMatch("ＦＩＮＡＬ ＦＡＮＴＡＳＹ ＶＩＩ", "final fantasy vii")).toBe(true);
  });

  it("never matches empty input", () => {
    expect(fuzzyMatch("", "")).toBe(false);
    expect(fuzzyMatch("Hades", "")).toBe(false);
    expect(fuzzyMatch(undefined, "Hades")).toBe(false);
  });
});

describe("matchesQuery", () => {
  const game = { title: "Control", notes: "Claimed via Prime Gaming" };

  it("matches the title or the notes", () => {
    expect(matchesQuery(game, "control")).toBe(true);
    expect(matchesQuery(game, "prime gaming")).toBe(true);
    expect(matchesQuery(game, "hades")).toBe(false);
  });

  it("does not match everything with notes when the query has no letters", () => {
    expect(matchesQuery(game, "!!")).toBe(false);
    expect(matchesQuery(game, "  ")).toBe(false);
  });

  it("does not match everything with notes for a kana-only query", () => {
    expect(matchesQuery(game, "ゼルダ")).toBe(false);
    expect(matchesQuery({ title: "ゼルダの伝説", notes: "" }, "ゼルダ")).toBe(true);
  });
});

describe("sourcesForPlatform", () => {
  it("offers PS Plus sources only on PlayStation", () => {
    expect(sourcesForPlatform("PS5")).toContain("ps_plus_catalog");
    expect(sourcesForPlatform("Steam")).not.toContain("ps_plus_catalog");
  });

  it("keeps the current source available when editing", () => {
    const list = sourcesForPlatform("Steam", "ps_plus_monthly");
    expect(list[0]).toBe("ps_plus_monthly");
    expect(list).toContain("purchased");
  });
});

describe("parsePastedTitles", () => {
  it("drops prices, dates, labels and duplicates from a pasted store page", () => {
    const text = [
      "Your Library",
      "• God of War Ragnarok",
      "PS5",
      "NT$ 1,790",
      "2024/03/01",
      "Purchased",
      "Stellar Blade",
      "god of war ragnarok",
      "x",
      "  - Astro Bot |",
    ].join("\r\n");
    expect(parsePastedTitles(text)).toEqual(["God of War Ragnarok", "Stellar Blade", "Astro Bot"]);
  });
});

describe("csvEscape", () => {
  it("leaves plain values untouched and blanks missing ones", () => {
    expect(csvEscape("Hades")).toBe("Hades");
    expect(csvEscape(9)).toBe("9");
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape(null)).toBe("");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvEscape("Hello, World")).toBe('"Hello, World"');
    expect(csvEscape('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
    expect(csvEscape("a\r\nb")).toBe('"a\r\nb"');
    expect(csvEscape("line\r")).toBe('"line\r"');
  });
});

describe("gamesToCSV", () => {
  it("writes a BOM, a header and one quoted row per game", () => {
    const csv = gamesToCSV([
      { id: "1", title: "薩爾達傳說, 王國之淚", platform: "NS1", source: "purchased", status: "completed", rating: 10, dateAdded: "2023-05-12" },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = csv.slice(1).split("\r\n");
    expect(header).toBe("id,title,platform,source,status,rating,hoursPlayed,notes,dateAdded,completedDate,leavingSoon");
    expect(row).toBe('1,"薩爾達傳說, 王國之淚",NS1,purchased,completed,10,,,2023-05-12,,');
  });
});

describe("daysBetween", () => {
  it("counts whole days left until the end of the end date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
    expect(daysBetween("2026-09-25")).toBe(0);
    expect(daysBetween("2026-09-26")).toBe(1);
    expect(daysBetween("2026-10-25")).toBe(30);
    expect(daysBetween("2026-09-24")).toBe(-1);
  });
});

describe("addMonths", () => {
  it("extends a future end date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
    expect(addMonths("2026-10-15", 1)).toBe("2026-11-15");
    expect(addMonths("2026-10-15", 12)).toBe("2027-10-15");
  });

  it("clamps month-end dates instead of rolling into the next month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 10, 10, 0, 0));
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonths("2027-12-31", 2)).toBe("2028-02-29");
    expect(addMonths("2026-08-31", 12)).toBe("2027-08-31");
  });

  it("renews a lapsed subscription from today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
    expect(addMonths("2026-01-01", 1)).toBe("2026-10-25");
    expect(addMonths("2026-09-25", 1)).toBe("2026-10-25");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(addMonths("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("local dates east of UTC", () => {
  const originalTZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Asia/Taipei";
  });
  afterAll(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  it("todayISO uses the local calendar day, not the UTC one", () => {
    vi.useFakeTimers();
    // 07:30 in Taipei is still the previous day in UTC
    vi.setSystemTime(new Date("2026-09-24T23:30:00Z"));
    expect(todayISO()).toBe("2026-09-25");
  });

  it("addMonths from today keeps the local day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T23:30:00Z"));
    expect(addMonths("2026-01-01", 1)).toBe("2026-10-25");
  });
});

describe("sanitizeGame", () => {
  const valid = { id: "g1", title: "Hades", platform: "Steam", source: "purchased", status: "backlog", dateAdded: "2024-01-01" };

  it("keeps a valid game", () => {
    expect(sanitizeGame(valid)).toEqual(valid);
  });

  it("rejects unknown platform, source or status", () => {
    expect(sanitizeGame({ ...valid, platform: "Xbox" })).toBeNull();
    expect(sanitizeGame({ ...valid, source: "stolen" })).toBeNull();
    expect(sanitizeGame({ ...valid, status: "meh" })).toBeNull();
    expect(sanitizeGame(null)).toBeNull();
    expect(sanitizeGame({ ...valid, title: "" })).toBeNull();
  });

  it("drops out-of-range optional fields", () => {
    const g = sanitizeGame({ ...valid, rating: 11, hoursPlayed: -1, notes: 5 });
    expect(g).not.toHaveProperty("rating");
    expect(g).not.toHaveProperty("hoursPlayed");
    expect(g).not.toHaveProperty("notes");
  });

  it("only keeps leavingSoon on subscription-dependent games", () => {
    expect(sanitizeGame({ ...valid, leavingSoon: true })).not.toHaveProperty("leavingSoon");
    expect(sanitizeGame({ ...valid, platform: "PS5", source: "ps_plus_catalog", leavingSoon: true }).leavingSoon).toBe(true);
  });

  it("assigns an id when missing", () => {
    const { id, ...noId } = valid;
    expect(typeof sanitizeGame(noId).id).toBe("string");
  });
});

describe("sanitizeSub", () => {
  it("requires a name and end date", () => {
    expect(sanitizeSub({ name: "PS Plus" })).toBeNull();
    expect(sanitizeSub({ endDate: "2026-01-01" })).toBeNull();
  });

  it("normalises fields", () => {
    expect(sanitizeSub({ id: "s1", name: "PS Plus", endDate: "2026-01-01T00:00:00Z", notes: 3 })).toEqual({
      id: "s1",
      name: "PS Plus",
      endDate: "2026-01-01",
      notes: "",
    });
  });
});

describe("isSubDependent", () => {
  it("flags subscription sources only", () => {
    expect(isSubDependent({ source: "game_pass" })).toBe(true);
    expect(isSubDependent({ source: "prime_gaming" })).toBe(false);
  });
});

describe("planSteamImport", () => {
  const library = [
    { id: "1", title: "Hades", platform: "Steam", source: "purchased", status: "completed", dateAdded: "2024-01-01" },
    { id: "2", title: "Stardew Valley", platform: "NS1", source: "purchased", status: "playing", dateAdded: "2024-01-01" },
  ];

  it("maps Steam games to backlog purchases with hours played", () => {
    const { added, skipped } = planSteamImport([{ appid: 1, name: "Celeste", playtime_forever: 95 }], library);
    expect(skipped).toBe(0);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ title: "Celeste", platform: "Steam", source: "purchased", status: "backlog", hoursPlayed: 1.6 });
  });

  it("skips titles already tracked on Steam, case-insensitively", () => {
    const { added, skipped } = planSteamImport([{ name: "HADES" }], library);
    expect(added).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("still imports a Steam copy of a game owned on another platform", () => {
    const { added } = planSteamImport([{ name: "Stardew Valley" }], library);
    expect(added.map((g) => g.title)).toEqual(["Stardew Valley"]);
  });

  it("ignores entries without a usable name and duplicates within the paste", () => {
    const { added, skipped } = planSteamImport([{ appid: 1 }, { name: 42 }, null, { name: "Celeste" }, { name: "celeste" }], library);
    expect(added.map((g) => g.title)).toEqual(["Celeste"]);
    expect(skipped).toBe(1);
    expect(added[0]).not.toHaveProperty("hoursPlayed");
  });
});
