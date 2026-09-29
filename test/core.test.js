import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGlobals, unwrap } from "./load.js";
import { fixtures, toInput } from "./fixtures.js";

const C = unwrap(loadGlobals(["core.uc.js"]).ZTCore);
const idx = (id) => Number(id.slice(1));

// Pairwise precision/recall of a grouping against the expected one.
function score(result, expect) {
  const groupOf = new Map();
  result.groups.forEach((g, gi) => g.ids.forEach((id) => groupOf.set(idx(id), gi)));
  const expectedPairs = new Set();
  for (const g of expect) for (const a of g) for (const b of g) if (a < b) expectedPairs.add(`${a},${b}`);
  let tp = 0, fp = 0;
  for (const g of result.groups) {
    const m = g.ids.map(idx);
    for (const a of m) for (const b of m) if (a < b) expectedPairs.has(`${a},${b}`) ? tp++ : fp++;
  }
  return { precision: tp + fp ? tp / (tp + fp) : 1, recall: expectedPairs.size ? tp / expectedPairs.size : 1, groupOf };
}

for (const f of fixtures) {
  test(`groups "${f.name}" sensibly`, () => {
    const r = C.groupTabs(toInput(f));
    const s = score(r, f.expect);
    assert.ok(s.precision >= 0.9, `precision ${s.precision.toFixed(2)}: ${JSON.stringify(r.groups)}`);
    assert.ok(s.recall >= 0.8, `recall ${s.recall.toFixed(2)}: ${JSON.stringify(r.groups)}`);
    for (const [i, re] of Object.entries(f.names)) {
      const g = r.groups[s.groupOf.get(Number(i))];
      assert.ok(g, `tab ${i} should be grouped`);
      assert.match(g.name, re, `name of the group containing tab ${i}`);
    }
    const all = r.groups.flatMap((g) => g.ids).concat(r.leftovers);
    assert.equal(all.length, f.tabs.length, "every tab accounted for exactly once");
    assert.equal(new Set(all).size, f.tabs.length);
  });
}

test("respects min group size and max folders", () => {
  const f = fixtures[0];
  const r = C.groupTabs(toInput(f), { maxFolders: 2, minGroupSize: 3 });
  assert.ok(r.groups.length <= 2);
  assert.ok(r.groups.every((g) => g.ids.length >= 3));
});

test("keeps sidebar order inside each group", () => {
  const r = C.groupTabs(toInput(fixtures[0]));
  for (const g of r.groups) assert.deepEqual(g.ids, [...g.ids].sort((a, b) => idx(a) - idx(b)));
});

test("group names are unique", () => {
  const tabs = [
    ["https://a.com/1", "Alpha report"], ["https://a.com/2", "Alpha notes"],
    ["https://b.com/1", "Alpha report"], ["https://b.com/2", "Alpha notes"],
  ].map(([url, title], i) => ({ id: `t${i}`, url, title }));
  const names = C.groupTabs(tabs, { similarity: 0.99 }).groups.map((g) => g.name);
  assert.equal(new Set(names).size, names.length);
});

test("siteOf recognises searches and product subdomains", () => {
  assert.equal(C.siteOf("https://www.google.com/search?q=cats").search, "cats");
  assert.equal(C.siteOf("https://duckduckgo.com/?q=dogs").search, "dogs");
  assert.equal(C.siteOf("https://mail.google.com/mail").key, "mail.google.com");
  assert.equal(C.siteOf("https://bbc.co.uk/news").key, "bbc.co.uk");
  assert.equal(C.siteOf("https://github.com/zen-browser/desktop").fine, "github.com/zen-browser");
  assert.equal(C.prettySite("docs.google.com/spreadsheets"), "Google Sheets");
  assert.equal(C.prettySite("github.com/zen-browser"), "GitHub · zen-browser");
  assert.equal(C.prettySite("example.org"), "Example");
});

test("cleanTitle drops counters and site suffixes only", () => {
  assert.equal(C.cleanTitle("(3) Lo-fi beats - YouTube", { host: "youtube.com" }), "Lo-fi beats");
  assert.equal(C.cleanTitle("Inbox - Gmail", { host: "mail.google.com" }), "Inbox - Gmail");
  assert.equal(C.cleanTitle("Rust - The Book", { host: "doc.rust-lang.org" }), "Rust - The Book");
});

test("findDuplicates keeps the selected or most recent copy", () => {
  const tabs = [
    { id: "a", url: "https://x.com/p#top", lastAccessed: 5 },
    { id: "b", url: "https://www.x.com/p/", lastAccessed: 9 },
    { id: "c", url: "https://x.com/p", lastAccessed: 1, selected: true },
    { id: "d", url: "https://x.com/other", lastAccessed: 1 },
    { id: "e", url: "https://y.com/", lastAccessed: 3 },
    { id: "f", url: "https://y.com", lastAccessed: 4 },
  ];
  assert.deepEqual(C.findDuplicates(tabs).sort(), ["a", "b", "e"]);
});

test("matchFolders finds a folder by site or by name", () => {
  const groups = [
    { name: "GitHub · zen-browser", bucket: { key: "github.com/zen-browser", share: 1 } },
    { name: "Recipes", bucket: { key: "", share: 0 } },
    { name: "Something new", bucket: { key: "new.com", share: 1 } },
  ];
  const folders = [
    { id: "f1", name: "Zen dev", urls: ["https://github.com/zen-browser/desktop", "https://github.com/zen-browser/www"] },
    { id: "f2", name: "recipes", urls: [] },
  ];
  assert.deepEqual(C.matchFolders(groups, folders), { 0: "f1", 1: "f2" });
});

test("AI group request sends titles and hostnames only", () => {
  const req = C.aiGroupRequest([{ id: "t0", url: "https://mail.google.com/mail/u/0/#inbox?token=secret", title: "(2) Inbox - Gmail" }]);
  assert.match(req.user, /1\. Inbox - Gmail \(mail\.google\.com\)/);
  assert.ok(!req.user.includes("secret"), "no full URLs");
  assert.deepEqual(req.ids, ["t0"]);
  assert.equal(req.schema.properties.groups.type, "array");
});

test("parseAiGroups drops invalid, duplicate and too-small groups", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const r = C.parseAiGroups({ groups: [
    { name: "One", tabs: [1, 2, 2, 99] },
    { name: "Two", tabs: [2, 3] },
    { name: "<b>Three</b>", tabs: [3, 4, 5] },
    { name: "", tabs: [] },
  ] }, ids);
  assert.deepEqual(r.groups.map((g) => [g.name, g.ids]), [["One", ["a", "b"]], ["bThree/b", ["c", "d", "e"]]]);
  assert.deepEqual(r.leftovers, []);
  assert.throws(() => C.parseAiGroups({ nope: 1 }, ids));
});

test("titles: AI parsing and local cleanup", () => {
  const ids = ["a", "b"];
  assert.deepEqual(C.parseAiTitles({ titles: [{ tab: 1, title: "Short" }, { tab: 7, title: "x" }, { tab: 2, title: "" }] }, ids), { a: "Short" });
  const cleaned = C.cleanTitles([
    { id: "a", url: "https://youtube.com/watch?v=1", title: "(4) Lo-fi beats - YouTube" },
    { id: "b", url: "https://example.com", title: "Plain" },
  ]);
  assert.deepEqual(cleaned, { a: "Lo-fi beats" });
});

test("shouldAutoTidy honours threshold and cooldown", () => {
  const base = { enabled: true, count: 20, threshold: 15, lastTidyAt: 0, now: 10 * 60_000 };
  assert.equal(C.shouldAutoTidy(base), true);
  assert.equal(C.shouldAutoTidy({ ...base, enabled: false }), false);
  assert.equal(C.shouldAutoTidy({ ...base, count: 10 }), false);
  assert.equal(C.shouldAutoTidy({ ...base, lastTidyAt: base.now - 60_000 }), false);
});
