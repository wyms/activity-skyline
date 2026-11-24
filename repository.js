"use strict";

const SkylineRepository = (() => {
  const login = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?$/;
  const repository = /^[A-Za-z0-9_.-]{1,100}$/;
  const revision = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
  const maxPages = 50;

  function sourceFrom(value) {
    let path = value.trim();
    if (/^(?:www\.)?github\.com\//i.test(path)) path = "https://" + path;
    const clone = /^git@github\.com:/i.test(path);
    if (clone) path = path.slice("git@github.com:".length);
    if (path.includes("://")) {
      let url;
      try { url = new URL(path); } catch { throw new Error("Enter a GitHub profile or repository URL."); }
      if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname) ||
          url.username || url.password || url.port)
        throw new Error("Use a profile or repository URL on github.com.");
      path = url.pathname;
    }
    const pieces = path.replace(/^\/+|\/+$/g, "").split("/");
    if (pieces.length === 1 && !clone) {
      const handle = pieces[0].replace(/^@/, "");
      if (login.test(handle)) return {kind:"profile", name:handle};
    }
    if (pieces.length === 2) pieces[1] = pieces[1].replace(/\.git$/i, "");
    if (pieces.length !== 2 || !login.test(pieces[0]) || !repository.test(pieces[1]) || [".",".."].includes(pieces[1]))
      throw new Error("Enter a GitHub handle, profile URL, or main repository URL.");
    return {kind:"repo", name:pieces.join("/")};
  }

  function nameFrom(value) {
    const source = sourceFrom(value);
    if (source.kind !== "repo") throw new Error("Enter the repository owner and name, such as vitejs/vite.");
    return source.name;
  }

  function defaultLabel({source = "", contributor = "", owner = ""}) {
    const author = contributor.replace(/^@/, "");
    if (login.test(author)) return author;
    if (login.test(owner)) return owner;
    try { return sourceFrom(source).name.split("/")[0]; }
    catch { return source.split("/").pop(); }
  }

  async function commits(url, signal, request) {
    let response;
    try { response = await request(url, {signal, credentials:"omit", referrerPolicy:"no-referrer"}); }
    catch (err) {
      if (signal?.aborted) throw err;
      const offline = new Error("Couldn’t reach GitHub. Check your connection, or import a local activity file.");
      offline.name = "RepositoryNetworkError";
      throw offline;
    }
    if (response.status === 404) throw new Error("GitHub couldn’t find a public repository at that URL. Check the spelling, or import a local file for a private repository.");
    if ([403, 429].includes(response.status)) throw new Error("GitHub limited this request. Try again later or import daily counts from a local checkout.");
    if (response.status === 409) {
      const error = await response.json().catch(() => ({}));
      if (/repository is empty/i.test(error?.message || "")) return {items:[], more:false};
    }
    if (!response.ok) throw new Error("GitHub returned an error (" + response.status + "). Please try again.");
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error("GitHub returned an unreadable commit list.");
    const pages = response.headers.get("link");
    // A full page with unavailable pagination headers needs one more read to establish the end.
    return {items, more:pages ? /rel="next"/.test(pages) : items.length === 100};
  }

  // The public REST API permits a direct browser read even when the studio is a local file.
  async function read({source, year, author = "", signal, onProgress, request = fetch}) {
    const name = nameFrom(source);
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < 2008 || year > currentYear) throw new Error("Choose a year from 2008 through the current year.");
    const contributor = author.trim().replace(/^@/, "");
    if (contributor && !login.test(contributor)) throw new Error("Enter the contributor’s GitHub username.");
    const endpoint = "https://api.github.com/repos/" + name + "/commits";
    const tip = await commits(endpoint + "?per_page=1", signal, request);
    const result = {source:name, year, kind:"repo", contributor, days:{}};
    if (!tip.items.length) return result;
    const sha = tip.items[0]?.sha;
    if (!revision.test(sha)) throw new Error("GitHub didn’t return a default-branch revision.");
    const params = new URLSearchParams({sha, since:(year - 1) + "-12-31T23:59:59Z",
      until:(year + 1) + "-01-01T00:00:00Z", per_page:"100"});
    if (contributor) params.set("author", contributor);
    const seen = new Set();
    for (let page = 1; page <= maxPages; page++) {
      params.set("page", String(page));
      const {items, more} = await commits(endpoint + "?" + params, signal, request);
      for (const entry of items) {
        const stamp = entry?.commit?.committer?.date;
        if (!revision.test(entry?.sha) || typeof stamp !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/i.test(stamp) || !Number.isFinite(Date.parse(stamp)))
          throw new Error("A commit contained an unreadable date. Try importing local daily counts.");
        if (seen.has(entry.sha)) continue;
        seen.add(entry.sha);
        const day = new Date(stamp).toISOString().slice(0,10);
        if (day.startsWith(year + "-")) result.days[day] = (result.days[day] || 0) + 1;
      }
      if (!more) return result;
      onProgress?.(seen.size);
    }
    throw new Error("This year exceeds the public import limit. Import daily counts from a local checkout for the complete model.");
  }

  return {sourceFrom, nameFrom, defaultLabel, read};
})();
if (typeof module !== "undefined" && module.exports) module.exports = SkylineRepository;
