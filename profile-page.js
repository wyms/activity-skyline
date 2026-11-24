"use strict";

// Reads daily counts from a saved copy of GitHub's contribution calendar page.
// The saved page is handled as plain text. It is never turned into a document, added to this page or run.
const SkylineProfilePage = (() => {
  const login = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?$/;
  const dayLength = 86400000;
  const maxCount = 1_000_000;
  const maxLength = 8 * 1024 * 1024;
  // One opening tag and the text that follows it. Every part is bounded, so matching stays linear.
  const tag = /<(td|tool-tip)\s([^<>]{1,4000})>([^<]{0,300})/gi;
  const dateAttribute = /(?:^|\s)data-date=["'](\d{4}-\d\d-\d\d)["']/i;
  const idAttribute = /(?:^|\s)id=["']([\w-]{1,100})["']/i;
  const forAttribute = /(?:^|\s)for=["']([\w-]{1,100})["']/i;
  const tally = /^(No|\d[\d,]{0,12})\s+contributions?\b/i;
  const missing = "This file doesn’t hold a GitHub contribution calendar. Open the link in step 1 and save that page.";

  function checkYear(year) {
    if (!Number.isInteger(year) || year < 2008 || year > 9999) throw new Error("Choose a calendar year from 2008 onward.");
  }

  function address(name, year) {
    if (typeof name !== "string" || !login.test(name)) throw new Error("Enter a GitHub handle.");
    checkYear(year);
    return "https://github.com/users/" + name + "/contributions?from=" + year + "-01-01&to=" + year + "-12-31";
  }

  function read(text, year) {
    checkYear(year);
    if (typeof text !== "string" || !text) throw new Error(missing);
    if (text.length > maxLength) throw new Error("Choose the calendar page saved from GitHub. It is smaller than 8 MB.");
    const cells = new Map(), tips = new Map();
    for (const [, name, attributes, trailing] of text.matchAll(tag)) {
      if (name.toLowerCase() === "td") {
        const date = dateAttribute.exec(attributes), id = idAttribute.exec(attributes);
        if (!date || !id) continue;
        if (cells.has(id[1]) && cells.get(id[1]) !== date[1]) throw new Error(missing);
        cells.set(id[1], date[1]);
      } else {
        const target = forAttribute.exec(attributes);
        if (!target) continue;
        if (tips.has(target[1]) && tips.get(target[1]).trim() !== trailing.trim()) throw new Error(missing);
        tips.set(target[1], trailing);
      }
    }
    if (!cells.size) throw new Error(missing);
    const days = Object.create(null), years = new Set();
    for (const [id, date] of cells) {
      years.add(date.slice(0, 4));
      if (!date.startsWith(year + "-")) continue;
      const match = tally.exec((tips.get(id) || "").trim());
      if (!match) throw new Error(missing);
      const count = /^no$/i.test(match[1]) ? 0 : Number(match[1].replaceAll(",", ""));
      if (!Number.isSafeInteger(count) || count > maxCount) throw new Error(missing);
      if (Object.hasOwn(days, date) && days[date] !== count) throw new Error(missing);
      days[date] = count;
    }
    const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
    for (let stamp = start; stamp < end; stamp += dayLength) {
      if (Object.hasOwn(days, new Date(stamp).toISOString().slice(0, 10))) continue;
      const saved = [...years].filter(value => value !== String(year)).sort();
      throw new Error(Object.keys(days).length || !saved.length
        ? "This saved page is missing some days of " + year + ". Open the link in step 1 and save the page again."
        : "This saved page holds the " + saved[saved.length - 1] + " calendar. Choose that year, or save the " + year + " page.");
    }
    return {...days};
  }

  return {address, read, maxLength};
})();
if (typeof module !== "undefined" && module.exports) module.exports = SkylineProfilePage;
