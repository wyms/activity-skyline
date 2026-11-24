const test = require("node:test");
const assert = require("node:assert/strict");
const Lookup = require("../site/profile-lookup.js");

const dayLength = 86400000;
// A reply shaped like the calendar service's: one entry for every day of the year.
function reply(year, counts = {}) {
  const contributions = [];
  for (let stamp = Date.UTC(year, 0, 1); stamp < Date.UTC(year + 1, 0, 1); stamp += dayLength) {
    const date = new Date(stamp).toISOString().slice(0, 10);
    contributions.push({date, count:counts[date] || 0, level:0});
  }
  return {total:{[year]:Object.values(counts).reduce((sum, count) => sum + count, 0)}, contributions};
}
const answer = (payload, status = 200) => async () => new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {status});
const unavailable = {name:"ProfileLookupUnavailable"};

test("a lookup address holds only a checked handle and year", () => {
  assert.equal(Lookup.address("octocat", 2025), "https://github-contributions-api.jogruber.de/v4/octocat?y=2025");
  assert.equal(Lookup.address("a_b-c", 2008), "https://github-contributions-api.jogruber.de/v4/a_b-c?y=2008");
  for (const name of ["", "-lead", "trail-", "a/b", "a?y=1", "a#b", "a b", "../v4", "%2e%2e", "x".repeat(40), null, 7])
    assert.throws(() => Lookup.address(name, 2025), /GitHub handle/);
  for (const year of [2007, new Date().getUTCFullYear() + 1, 2025.5, "2025", NaN])
    assert.throws(() => Lookup.address("octocat", year), /year from 2008/);
});

test("a full year of counts is read into days", async () => {
  const seen = [];
  const request = async (url, options) => { seen.push([url, options]); return answer(reply(2024, {"2024-02-29":7, "2024-12-31":3}))(); };
  const result = await Lookup.read({name:"octocat", year:2024, request});
  assert.equal(result.source, "octocat");
  assert.equal(result.year, 2024);
  assert.equal(result.kind, "profile");
  assert.equal(Object.keys(result.days).length, 366);
  assert.equal(result.days["2024-02-29"], 7);
  assert.equal(result.days["2024-12-31"], 3);
  assert.equal(result.days["2024-01-01"], 0);
  const [url, options] = seen[0];
  assert.equal(url, "https://github-contributions-api.jogruber.de/v4/octocat?y=2024");
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.redirect, "error");
  assert.equal(seen.length, 1);
});

test("a bad handle or year never reaches the network", async () => {
  let calls = 0;
  const request = async () => { calls++; return answer(reply(2025))(); };
  await assert.rejects(Lookup.read({name:"a/b", year:2025, request}), /GitHub handle/);
  await assert.rejects(Lookup.read({name:"octocat", year:1999, request}), /year from 2008/);
  assert.equal(calls, 0);
});

test("an unknown handle is reported as such", async () => {
  await assert.rejects(Lookup.read({name:"octocat", year:2025, request:answer({error:"not found"}, 404)}),
    {name:"ProfileNotFound", message:/No public GitHub profile is named @octocat/});
});

test("a reply that is not a complete, well-formed year is refused", () => {
  const broken = change => { const payload = reply(2025, {"2025-03-04":2}); change(payload.contributions, payload); return payload; };
  const cases = [
    null, 7, "text", [], {}, {contributions:"all"}, {contributions:{length:365}},
    broken(list => list.pop()),
    broken(list => list.push({date:"2026-01-01", count:0})),
    broken(list => { list[10] = {...list[9]}; }),
    broken(list => { list[0].date = "2024-01-01"; }),
    broken(list => { list[40].date = "2025-02-30"; }),
    broken(list => { list[5].date = "<img src=x onerror=run()>"; }),
    broken(list => { list[5].date = "2025-01-06T00:00:00Z"; }),
    broken(list => { list[5].date = 20250106; }),
    broken(list => { list[5].count = "4"; }),
    broken(list => { list[5].count = 1.5; }),
    broken(list => { list[5].count = -1; }),
    broken(list => { list[5].count = 1_000_001; }),
    broken(list => { list[5].count = null; }),
    broken(list => { list[5] = null; }),
    broken(list => { list[5] = "2025-01-06"; }),
    broken(list => { list[5].date = "__proto__"; })
  ];
  for (const payload of cases) assert.throws(() => Lookup.days(payload, 2025), unavailable, JSON.stringify(payload)?.slice(0, 80));
  assert.equal(Lookup.days(reply(2025, {"2025-03-04":2}), 2025)["2025-03-04"], 2);
  assert.equal(Object.getPrototypeOf(Lookup.days(reply(2025), 2025)), Object.prototype);
});

test("a failing, unreadable or oversized service falls back instead of guessing", async () => {
  const fails = request => assert.rejects(Lookup.read({name:"octocat", year:2025, request}), unavailable);
  for (const status of [400, 403, 429, 500, 503]) await fails(answer(reply(2025), status));
  await fails(async () => { throw new TypeError("network down"); });
  await fails(answer("<html>maintenance</html>"));
  await fails(answer(""));
  await fails(answer(reply(2024)));
  await fails(answer({...reply(2025), padding:"x".repeat(300 * 1024)}));
  // A reply with no readable stream is still size-checked.
  await fails(async () => ({status:200, ok:true, text:async () => "x".repeat(300 * 1024)}));
  // An endless reply is cut off rather than read to the end.
  let pulled = 0;
  const endless = new ReadableStream({pull(controller) { pulled++; controller.enqueue(new Uint8Array(64 * 1024)); }});
  await fails(async () => new Response(endless, {status:200}));
  assert.ok(pulled < 20, "kept reading " + pulled + " chunks");
});

test("a slow service is abandoned, and leaving the page mid-lookup is not reported as a failure", async () => {
  let asked = 0;
  const hang = (url, {signal}) => new Promise((resolve, reject) => {
    asked++;
    signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")));
  });
  const started = Date.now();
  await assert.rejects(Lookup.read({name:"octocat", year:2025, request:hang, wait:30}), unavailable);
  assert.ok(Date.now() - started < 2000);
  const controller = new AbortController();
  const pending = assert.rejects(Lookup.read({name:"octocat", year:2025, request:hang, signal:controller.signal}), {name:"AbortError"});
  controller.abort();
  await pending;
  const before = new AbortController(); before.abort();
  asked = 0;
  await assert.rejects(Lookup.read({name:"octocat", year:2025, request:hang, signal:before.signal}), {name:"AbortError"});
  assert.equal(asked, 0, "a lookup that was already called off must not reach the network");
});
