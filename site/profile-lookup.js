"use strict";

// Asks an independent calendar service for a profile's public daily counts.
// The reply is read as dates and whole numbers. Nothing in it is shown as markup or run.
const SkylineProfileLookup = (() => {
  const login = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?$/;
  const service = "https://github-contributions-api.jogruber.de/v4/";
  const dayLength = 86400000;
  const maxCount = 1_000_000;
  const maxLength = 256 * 1024;
  const patience = 15000;

  function unavailable() {
    const error = new Error("The calendar lookup didn’t answer. Try again, or bring the calendar in yourself with the steps below.");
    error.name = "ProfileLookupUnavailable";
    return error;
  }

  function address(name, year) {
    if (typeof name !== "string" || !login.test(name)) throw new Error("Enter a GitHub handle.");
    if (!Number.isInteger(year) || year < 2008 || year > new Date().getUTCFullYear())
      throw new Error("Choose a year from 2008 through the current year.");
    return service + name + "?y=" + year;
  }

  // A reply counts only when it holds every day of the year exactly once, each with a whole count.
  function days(payload, year) {
    const list = payload?.contributions;
    const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
    if (!Array.isArray(list) || list.length !== (end - start) / dayLength) throw unavailable();
    const found = Object.create(null);
    for (const entry of list) {
      const date = entry?.date, count = entry?.count;
      if (typeof date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(date) || date in found ||
          !Number.isSafeInteger(count) || count < 0 || count > maxCount) throw unavailable();
      found[date] = count;
    }
    for (let stamp = start; stamp < end; stamp += dayLength)
      if (!(new Date(stamp).toISOString().slice(0, 10) in found)) throw unavailable();
    return {...found};
  }

  // Stops reading once the reply is larger than any real calendar.
  async function body(response) {
    const reader = response.body?.getReader?.();
    if (!reader) {
      const text = await response.text();
      if (text.length > maxLength) throw unavailable();
      return text;
    }
    const decoder = new TextDecoder();
    let text = "", size = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maxLength) { reader.cancel().catch(() => {}); throw unavailable(); }
      text += decoder.decode(value, {stream:true});
    }
  }

  async function read({name, year, signal, request = fetch, wait = patience}) {
    const url = address(name, year);
    signal?.throwIfAborted();
    const own = new AbortController(), stop = () => own.abort();
    signal?.addEventListener("abort", stop, {once:true});
    const timer = setTimeout(stop, wait);
    try {
      const response = await request(url, {signal:own.signal, credentials:"omit", referrerPolicy:"no-referrer", redirect:"error"});
      if (response.status === 404) {
        const absent = new Error("No public GitHub profile is named @" + name + ". Check the spelling.");
        absent.name = "ProfileNotFound";
        throw absent;
      }
      if (!response.ok) throw unavailable();
      return {source:name, year, kind:"profile", days:days(JSON.parse(await body(response)), year)};
    } catch (error) {
      // The visitor moved on, or the handle is unknown. Anything else means the service gave no usable calendar.
      if (signal?.aborted || error?.name === "ProfileNotFound") throw error;
      throw unavailable();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }

  return {address, days, read};
})();
if (typeof module !== "undefined" && module.exports) module.exports = SkylineProfileLookup;
