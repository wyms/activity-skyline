// Publish checks. Run before every commit and in CI: `node tools/check.mjs`.
// They fail when the site would ship a file, address, script pattern or personal detail that was not reviewed.
import {readFileSync, readdirSync, statSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The complete published site. Anything else inside site/ fails the check.
const siteFiles = [
  "calendar.js", "example.js", "index.html", "kit.js", "mesh.js", "profile-page.js", "repository.js",
  "studio.css", "studio.js", "viewer.js", "vite-2026-studio.png",
  "fonts/Cormorant-Garamond-LICENSE.txt", "fonts/DM-Sans-LICENSE.txt",
  "fonts/cormorant-garamond-400-italic.woff2", "fonts/cormorant-garamond-500-normal.woff2",
  "fonts/dm-sans-400-normal.woff2", "fonts/dm-sans-600-normal.woff2"
];
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; " +
  "connect-src https://api.github.com; base-uri 'none'; form-action 'none'; object-src 'none'; " +
  "require-trusted-types-for 'script'; trusted-types 'none'";
// Hosts the site may link to or call. XML namespace names are identifiers and are never fetched.
const linkHosts = ["github.com", "mandarin3d.com", "dcadditivepros.com"];
const scriptHosts = ["api.github.com", "github.com"];
const namespaceHosts = ["schemas.openxmlformats.org", "schemas.microsoft.com"];
// Hosts that may be named in documentation, licences and tests. Names ending in .test are reserved and never resolve.
const documentHosts = [...linkHosts, ...scriptHosts, "www.github.com", "docs.github.com", "gitlab.com",
  "openfontlicense.org", "scripts.sil.org", "127.0.0.1", "localhost"];
const browserCalls = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function",
  "DOMParser", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "postMessage", "importScripts",
  "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "serviceWorker", "window.open", "srcdoc", "javascript:"];
const textTypes = /\.(?:html|css|js|cjs|mjs|json|md|txt|yml|yaml|svg|xml|sh|py)$|(?:^|\/)\.[\w.-]+$|(?:^|\/)LICENSE$/i;
const skipped = new Set([".git", "node_modules", "_site"]);

const problems = [];
const fail = (file, text) => problems.push(file + ": " + text);
const read = file => readFileSync(path.join(root, file), "utf8");

function walk(directory, prefix = "") {
  return readdirSync(path.join(root, directory, prefix), {withFileTypes:true}).flatMap(entry => {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    if (!prefix && directory === "." && skipped.has(entry.name)) return [];
    if (entry.isSymbolicLink()) { fail(path.join(directory, relative), "symbolic links are not published"); return []; }
    return entry.isDirectory() ? walk(directory, relative) : [relative];
  });
}
function hostOf(address) {
  try { return new URL(address).hostname.toLowerCase(); } catch { return ""; }
}
const addressPattern = /\b(?:https?|wss?|ftp):\/\/[^\s"'`<>()\\\/;,]+/gi;
// Every address in the text as {secure, host, text}; only the scheme and host are judged.
function addresses(text) {
  return (text.match(addressPattern) || []).map(found => ({secure:/^https:/i.test(found), host:hostOf(found), text:found}));
}
const isNamespace = address => !address.secure && namespaceHosts.includes(address.host);

// 1. The published folder holds exactly the reviewed files.
const published = walk("site").sort();
for (const file of published) if (!siteFiles.includes(file)) fail("site/" + file, "not on the published file list");
for (const file of siteFiles) if (!published.includes(file)) fail("site/" + file, "listed for publishing but missing");

// 2. The page: fixed content policy, no inline code, local resources, reviewed outbound links.
const page = read("site/index.html");
const tags = page.match(/<[a-zA-Z][^>]*>/g) || [];
const attribute = (tag, name) => new RegExp("\\s" + name + '="([^"]*)"', "i").exec(tag)?.[1];
const policies = tags.filter(tag => /http-equiv="Content-Security-Policy"/i.test(tag));
if (policies.length !== 1 || attribute(policies[0], "content") !== policy) fail("site/index.html", "content policy differs from the reviewed policy");
if (page.indexOf("Content-Security-Policy") > page.search(/<(?:script|link|style|img)\b/i)) fail("site/index.html", "content policy must come before any resource");
if (!tags.some(tag => /^<meta\b/i.test(tag) && attribute(tag, "name") === "referrer" && attribute(tag, "content") === "no-referrer"))
  fail("site/index.html", "referrer policy is missing");
for (const tag of tags) {
  const name = /^<([a-zA-Z0-9-]+)/.exec(tag)[1].toLowerCase();
  if (["base", "iframe", "frame", "object", "embed", "style", "applet", "portal"].includes(name)) fail("site/index.html", "<" + name + "> is not allowed");
  if (/\son[a-z]+\s*=/i.test(tag)) fail("site/index.html", "inline event handler in " + tag.slice(0, 60));
  if (/\sstyle\s*=/i.test(tag)) fail("site/index.html", "inline style in " + tag.slice(0, 60));
  if (name === "script" && (!attribute(tag, "src") || !/\sdefer(?:\s|>)/i.test(tag))) fail("site/index.html", "scripts must be deferred local files");
  if (name === "form" && /\saction\s*=/i.test(tag)) fail("site/index.html", "forms must not post anywhere");
  for (const key of ["src", "href"]) {
    const value = attribute(tag, key);
    if (value === undefined || value.startsWith("#")) continue;
    if (value.startsWith("./")) {
      if (!siteFiles.includes(value.slice(2))) fail("site/index.html", "missing local file " + value);
    } else if (name === "a" && value.startsWith("https://") && linkHosts.includes(hostOf(value))) {
      const rel = (attribute(tag, "rel") || "").split(/\s+/);
      if (!rel.includes("noopener") || !rel.includes("noreferrer")) fail("site/index.html", "outbound link needs rel noopener noreferrer: " + value);
    } else fail("site/index.html", "unreviewed address " + value);
  }
  if (name === "a" && attribute(tag, "target") && !/noopener/.test(attribute(tag, "rel") || "")) fail("site/index.html", "target without noopener");
}
if (/<script\b[^>]*>[^<\s]/i.test(page)) fail("site/index.html", "inline script");

// 3. Scripts and styles: no risky browser calls, no unreviewed hosts, no remote styles.
for (const file of siteFiles.filter(name => /\.(?:js|css)$/.test(name))) {
  const text = read("site/" + file);
  for (const call of browserCalls) if (text.includes(call)) fail("site/" + file, "uses " + call);
  for (const address of addresses(text))
    if (!isNamespace(address) && !(address.secure && scriptHosts.includes(address.host))) fail("site/" + file, "unreviewed address " + address.text);
  if (file.endsWith(".css")) {
    if (/@import/i.test(text)) fail("site/" + file, "@import is not allowed");
    for (const [, target] of text.matchAll(/url\(\s*["']?([^"')]+)/gi))
      if (!siteFiles.includes(target)) fail("site/" + file, "unreviewed url(" + target + ")");
  }
}

// 4. Images carry pixels only: no text, time, colour-profile or location chunks.
for (const file of siteFiles.filter(name => name.endsWith(".png"))) {
  const bytes = readFileSync(path.join(root, "site", file));
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") { fail("site/" + file, "not a PNG"); continue; }
  for (let offset = 8; offset + 12 <= bytes.length; offset += 12 + bytes.readUInt32BE(offset)) {
    const chunk = bytes.toString("latin1", offset + 4, offset + 8);
    if (!["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(chunk)) fail("site/" + file, "metadata chunk " + chunk);
  }
}

// 5. Every text file in the repository: no personal details, credentials or unreviewed hosts.
const credential = [
  ["gh", "[pousr]_[A-Za-z0-9]{20,}"], ["github", "_pat_[A-Za-z0-9_]{20,}"], ["AK", "IA[0-9A-Z]{16}"],
  ["-----BEGIN", " [A-Z ]*PRIVATE KEY-----"], ["xox", "[abprs]-[A-Za-z0-9-]{10,}"], ["sk", "-[A-Za-z0-9_-]{24,}"],
  ["AIza", "[0-9A-Za-z_-]{30,}"]
].map(parts => new RegExp(parts.join("")));
const emailAddress = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const homeFolder = new RegExp(["/Use" + "rs/", "/ho" + "me/", "[A-Za-z]:\\\\Use" + "rs\\\\"].join("|") + "[A-Za-z0-9._-]+");
const networkAddress = /\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/;
const privateTerms = process.env.PRIVATE_TERMS_FILE && existsSync(process.env.PRIVATE_TERMS_FILE)
  ? readFileSync(process.env.PRIVATE_TERMS_FILE, "utf8").split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => line && !line.startsWith("#"))
  : [];
const everything = walk(".");
for (const file of everything) {
  const size = statSync(path.join(root, file)).size;
  if (size > 2 * 1024 * 1024) fail(file, "larger than 2 MB");
  if (/(?:^|\/)\.env|\.(?:pem|key|p12|pfx|sqlite|db|zip|stl|3mf|log)$|\.DS_Store$/i.test(file)) fail(file, "file type is not kept in this repository");
  if (!textTypes.test(file)) {
    if (!/\.(?:png|woff2)$/i.test(file)) fail(file, "unexpected file type");
    continue;
  }
  const text = read(file), lower = text.toLowerCase();
  for (const pattern of credential) if (pattern.test(text)) fail(file, "looks like a credential");
  // Addresses are judged by host below, and git@github.com is the public clone prefix, so neither counts as an email.
  if (emailAddress.test(text.replace(addressPattern, " ").replaceAll("git@github.com", " "))) fail(file, "contains an email address");
  if (homeFolder.test(text)) fail(file, "contains a home folder path");
  if (networkAddress.test(text)) fail(file, "contains a network address");
  for (const term of privateTerms) if (lower.includes(term)) fail(file, "contains a private term (line " + (lower.slice(0, lower.indexOf(term)).split("\n").length) + ")");
  if (!file.startsWith("site/") || /\.(?:txt|md)$/.test(file)) {
    for (const address of addresses(text))
      if (!isNamespace(address) && !documentHosts.includes(address.host) && !/^[\w-]+\.github\.io$|\.test$/.test(address.host))
        fail(file, "unreviewed address " + address.text);
  }
}

if (problems.length) {
  console.error("Publish checks failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("Publish checks passed: " + siteFiles.length + " site files, " + everything.length + " repository files" +
  (privateTerms.length ? ", " + privateTerms.length + " private terms" : "") + ".");
