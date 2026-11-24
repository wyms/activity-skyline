const test = require("node:test");
const assert = require("node:assert/strict");
const {address, read, maxLength} = require("../site/profile-page.js");
const {calendar} = require("../site/calendar.js");

const dayLength = 86400000;
const ordinal = n => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
// Builds a page with the markup GitHub serves for a contribution calendar.
function savedPage(year, counts = {}, {skip = [], tip = text => text} = {}) {
  const cells = [], tips = [];
  for (let stamp = Date.UTC(year,0,1), i = 0; stamp < Date.UTC(year+1,0,1); stamp += dayLength, i++) {
    const date = new Date(stamp), day = date.toISOString().slice(0,10);
    if (skip.includes(day)) continue;
    const id = "contribution-day-component-" + date.getUTCDay() + "-" + Math.floor(i / 7), n = counts[day] || 0;
    const label = (n ? n.toLocaleString("en-US") + " contribution" + (n === 1 ? "" : "s") : "No contributions") + " on " +
      date.toLocaleString("en-US",{month:"long",timeZone:"UTC"}) + " " + ordinal(date.getUTCDate()) + ".";
    cells.push('<td tabindex="0" data-ix="' + i + '" aria-selected="false" style="width: 11px" data-date="' + day + '" id="' + id +
      '" data-level="0" role="gridcell" data-view-component="true" class="ContributionCalendar-day"></td>');
    tips.push('<tool-tip style="pointer-events: none;" id="tooltip-' + i + '" for="' + id +
      '" popover="manual" data-direction="n" data-type="label" class="sr-only position-absolute">' + tip(label, day) + "</tool-tip>");
  }
  return '<div class="js-yearly-contributions"><h2>Contributions</h2><table><tbody><tr>' + cells.join("\n") + "</tr></tbody></table>\n" + tips.join("\n") + "</div>";
}

test("a saved calendar page yields one whole-number count for every day of the year", () => {
  const counts = {"2025-01-01":1, "2025-03-09":12, "2025-07-04":1234, "2025-12-31":7};
  const days = read(savedPage(2025, counts), 2025);
  assert.equal(Object.keys(days).length, 365);
  for (const [day, count] of Object.entries(counts)) assert.equal(days[day], count);
  assert.equal(days["2025-01-02"], 0);
  const result = calendar({source:"octocat", year:2025, kind:"profile", days});
  assert.deepEqual([result.total, result.active, result.peak], [1254, 4, 1234]);
  assert.equal(Object.keys(read(savedPage(2028), 2028)).length, 366);
});

test("a page saved twice into one file reads once, and conflicting copies are refused", () => {
  const page = savedPage(2025, {"2025-05-05":3});
  assert.equal(read(page + page, 2025)["2025-05-05"], 3);
  assert.throws(() => read(page + savedPage(2025, {"2025-05-05":4}), 2025), /doesn’t hold/);
});

test("the wrong year, missing days and other files explain what to do", () => {
  assert.throws(() => read(savedPage(2024), 2025), /holds the 2024 calendar/);
  assert.throws(() => read(savedPage(2025, {}, {skip:["2025-06-01"]}), 2025), /missing some days of 2025/);
  for (const text of ["", "date,count\n2025-01-01,1", "<html><body>Sign in to GitHub</body></html>", '{"year":2025,"days":{}}'])
    assert.throws(() => read(text, 2025), /doesn’t hold/);
  assert.throws(() => read("x".repeat(maxLength + 1), 2025), /smaller than 8 MB/);
  assert.throws(() => read(savedPage(2025), 1999), /2008/);
  assert.throws(() => read(savedPage(2025, {}, {tip:(text, day) => day === "2025-02-02" ? "Loading…" : text}), 2025), /doesn’t hold/);
});

test("hostile pages produce numbers only, or nothing", () => {
  const hostile = savedPage(2025, {"2025-01-01":2}) +
    '<script>window.pwned = 1</script><img src=x onerror="pwned()"><td data-date="__proto__" id="constructor"></td>' +
    '<td data-date="2025-01-01" id="x"><tool-tip for="x"><b>9 contributions</b></tool-tip>';
  assert.throws(() => read(hostile, 2025), /doesn’t hold/);
  const days = read(savedPage(2025, {"2025-01-01":2}) + '<script>window.pwned = 1</script><td data-date="__proto__" id="constructor"></td>', 2025);
  assert.equal(Object.getPrototypeOf(days), Object.prototype);
  for (const [day, count] of Object.entries(days)) {
    assert.match(day, /^2025-\d\d-\d\d$/);
    assert.ok(Number.isSafeInteger(count) && count >= 0);
  }
  assert.equal({}.pwned, undefined);
  assert.throws(() => read(savedPage(2025, {}, {tip:(text, day) => day === "2025-02-02" ? "99999999999999999999 contributions" : text}), 2025));
  assert.throws(() => read(savedPage(2025, {}, {tip:(text, day) => day === "2025-02-02" ? "1,000,001 contributions" : text}), 2025));
});

test("oversized, repetitive input is read in linear time", () => {
  for (const unit of ["<td ", "<tool-tip for='a'", "<td data-date=\"2025-01-01\" id=\"a\" ", "<", "<td " + "a".repeat(3990)]) {
    const text = unit.repeat(Math.floor(maxLength / unit.length));
    const started = process.hrtime.bigint();
    assert.throws(() => read(text, 2025));
    assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 3000, "took too long for " + unit.slice(0, 12));
  }
});

test("the calendar link is built only from a valid handle and year", () => {
  assert.equal(address("octocat", 2025), "https://github.com/users/octocat/contributions?from=2025-01-01&to=2025-12-31");
  assert.equal(address("octo_cat", 2024), "https://github.com/users/octo_cat/contributions?from=2024-01-01&to=2024-12-31");
  for (const name of ["", "-lead", "trail-", "two/parts", "a b", "a?x=1", "a#b", "../x", "a".repeat(40), "javascript:alert(1)", undefined, null, 7])
    assert.throws(() => address(name, 2025));
  for (const year of [2007, 1e4, 2025.5, "2025", NaN]) assert.throws(() => address("octocat", year));
});
