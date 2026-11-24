"use strict";

const SkylineCalendar = (() => {
  const dayLength = 86400000;
  const maxCount = 1_000_000;

  function calendar(input) {
    const year = input?.year;
    if (!Number.isInteger(year) || year < 2008 || year > 9999)
      throw new Error("Use a four-digit calendar year starting in 2008.");
    if (!input.days || Array.isArray(input.days) || typeof input.days !== "object")
      throw new Error("The JSON file needs a year and a days object with a count for each date.");
    const start = Date.UTC(year, 0, 1);
    const dayCount = (Date.UTC(year + 1, 0, 1) - start) / dayLength;
    const offset = new Date(start).getUTCDay();
    const weeks = Array.from({length:Math.ceil((offset + dayCount) / 7)}, () => Array(7).fill(0));
    let total = 0, active = 0, peak = 0;
    for (const [date, count] of Object.entries(input.days)) {
      if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new Error("Use ISO dates such as 2025-01-31.");
      const stamp = Date.parse(date + "T00:00:00Z");
      const index = (stamp - start) / dayLength;
      if (!Number.isInteger(index) || index < 0 || index >= dayCount || new Date(stamp).toISOString().slice(0,10) !== date)
        throw new Error("The file contains a date outside its calendar year or an invalid date.");
      if (!Number.isSafeInteger(count) || count < 0 || count > maxCount)
        throw new Error("Each daily count must be a whole number between 0 and 1,000,000.");
      const cell = offset + index;
      weeks[Math.floor(cell / 7)][cell % 7] = count;
      total += count;
      if (count) active++;
      peak = Math.max(peak, count);
    }
    const source = typeof input.source === "string" ? input.source.trim().slice(0,160) : "";
    const contributor=typeof input.contributor === "string" ? input.contributor.trim().slice(0,39) : "";
    const owner = typeof input.owner === "string" ? input.owner.trim().slice(0,39) : "";
    return {year, weeks, total, active, peak, source, contributor, owner, kind:input.kind === "repo" ? "repo" : "profile"};
  }

  function importFile(text) {
    const content = text.replace(/^\uFEFF/, "").trim();
    if (!content) throw new Error("Choose a file that contains daily activity.");
    if (content.startsWith("{")) {
      let data;
      try { data = JSON.parse(content); } catch { throw new Error("This JSON file could not be read."); }
      return calendar(data);
    }
    const lines = content.split(/\r\n|\n|\r/).map(line=>line.trim()).filter(Boolean);
    if (!/^date\s*,\s*count$/i.test(lines.shift() || ""))
      throw new Error("Use JSON with year and days, or a CSV whose first line is date,count.");
    const days = Object.create(null);
    let year;
    for (const [i,line] of lines.entries()) {
      const match = /^(\d{4}-\d\d-\d\d)\s*,\s*(\d+)$/.exec(line);
      if (!match) throw new Error("CSV row " + (i + 2) + " needs a date and a whole-number count.");
      const date = match[1], rowYear = Number(date.slice(0,4));
      if (year !== undefined && rowYear !== year) throw new Error("Import one calendar year per file.");
      if (Object.hasOwn(days,date)) throw new Error("The CSV repeats the date " + date + ".");
      days[date] = Number(match[2]);
      year = rowYear;
    }
    if (year === undefined) throw new Error("The CSV needs at least one dated row, which can have a zero count.");
    return calendar({year,days});
  }

  function sample(year) {
    let state = 78;
    const random = () => { state = (Math.imul(state,1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const start = Date.UTC(year,0,1), end = Date.UTC(year+1,0,1), days = {};
    for (let stamp = start; stamp < end; stamp += dayLength) {
      const i = (stamp - start) / dayLength, date = new Date(stamp);
      const weekday = date.getUTCDay();
      const probability = (weekday === 0 || weekday === 6) ? 0.22 : 0.77;
      if (random() < probability) {
        const release = 1 + 1.7 * Math.pow(Math.max(0,Math.sin(i / 21)),3);
        days[date.toISOString().slice(0,10)] = 1 + Math.floor(12 * random() * random() * release);
      }
    }
    return calendar({year,days,source:"Studio sample",kind:"profile"});
  }
  return {calendar,importFile,sample};
})();
if (typeof module !== "undefined" && module.exports) module.exports = SkylineCalendar;
