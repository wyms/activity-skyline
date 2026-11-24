// Publish checks. Run before every commit and by tools/publish.sh: `node tools/check.mjs`.
// They fail when the repository holds a file, address, script pattern or personal detail that was not reviewed.
// The browser's content policy is the enforcement; these checks keep that policy and the reviewed shape in place.
import {readFileSync, readdirSync, statSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Everything allowed at the top of the repository, and the complete published site.
const rootEntries = [".gitignore", "LICENSE", "README.md", "SECURITY.md", "package.json", "site", "tests", "tools"];
const siteFiles = [
  ".nojekyll", "calendar.js", "example.js", "index.html", "kit.js", "mesh.js", "profile-page.js", "repository.js",
  "studio.css", "studio.js", "viewer.js", "vite-2026-studio.png",
  "fonts/Cormorant-Garamond-LICENSE.txt", "fonts/DM-Sans-LICENSE.txt",
  "fonts/cormorant-garamond-400-italic.woff2", "fonts/cormorant-garamond-500-normal.woff2",
  "fonts/dm-sans-variable.woff2"
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
// The only elements and attributes the page uses. Anything else, including every on* handler and style, fails.
const elements = ["a", "body", "br", "button", "canvas", "dd", "details", "div", "dl", "dt", "em", "fieldset", "form",
  "h1", "h2", "h3", "head", "header", "html", "i", "img", "input", "label", "legend", "li", "link", "main", "meta",
  "nav", "noscript", "ol", "option", "p", "script", "section", "select", "small", "span", "strong", "summary", "title"];
const attributes = ["accept", "alt", "autocapitalize", "autocomplete", "charset", "checked", "class", "content",
  "decoding", "defer", "disabled", "fetchpriority", "for", "hidden", "href", "http-equiv", "id", "inputmode", "lang",
  "max", "maxlength", "min", "name", "placeholder", "rel", "required", "role", "selected", "spellcheck", "src", "step",
  "tabindex", "target", "title", "type", "value"];
const browserCalls = [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function/,
  /DOMParser/, /localStorage/, /sessionStorage/, /indexedDB/, /\.cookie\b/, /postMessage/, /importScripts/,
  /\bimport\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /RTCPeerConnection/, /sendBeacon/, /serviceWorker/,
  /\bWorker\b/, /window\.open/, /srcdoc/, /javascript:/i, /\blocation\b/, /\bnavigator\b/, /document\.domain/,
  /window\.name/, /["'`]\/\/[\w.-]/];
const textTypes = /\.(?:html|css|js|cjs|mjs|json|md|txt|sh)$|(?:^|\/)\.[\w.-]+$|(?:^|\/)LICENSE$/i;

const problems = [];
const fail = (file, text) => problems.push(file + ": " + text);
const read = file => readFileSync(path.join(root, file), "utf8");

function walk(directory, prefix = "") {
  return readdirSync(path.join(root, directory, prefix), {withFileTypes:true}).flatMap(entry => {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    if (directory === "." && !prefix) {
      if ([".git", "node_modules"].includes(entry.name)) return [];
      if (!rootEntries.includes(entry.name)) { fail(entry.name, "not an expected top-level file or folder"); return []; }
    }
    if (entry.isSymbolicLink()) { fail(path.join(directory, relative), "symbolic links are not allowed"); return []; }
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

// 2. The page. It is read with a deliberately narrow grammar: a doctype, then tags whose attributes are all
//    written name="value" or as a bare name. Comments, other quoting and stray angle brackets are refused,
//    so nothing can hide from the rules below.
function readPage(page) {
  const tags = [], opening = /^<!doctype html>\s*/i.exec(page);
  if (!opening) { fail("site/index.html", "must start with <!doctype html>"); return tags; }
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*(?:="[^"<>]*")?)*)\s*>/y;
  for (let position = opening[0].length; position < page.length;) {
    const next = page.indexOf("<", position);
    if (page.slice(position, next < 0 ? page.length : next).includes(">")) { fail("site/index.html", "stray > in text"); return tags; }
    if (next < 0) break;
    tag.lastIndex = next;
    const match = tag.exec(page);
    if (!match) { fail("site/index.html", "markup outside the reviewed grammar near " + JSON.stringify(page.slice(next, next + 50))); return tags; }
    const pairs = [...match[3].matchAll(/\s+([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"<>]*)")?/g)].map(found => [found[1].toLowerCase(), found[2] ?? ""]);
    if (new Set(pairs.map(pair => pair[0])).size !== pairs.length) fail("site/index.html", "repeated attribute in " + match[0].slice(0, 60));
    if (match[1] && pairs.length) fail("site/index.html", "attributes on a closing tag");
    if (!match[1]) tags.push({name:match[2].toLowerCase(), attributes:Object.fromEntries(pairs), text:match[0].slice(0, 70)});
    position = tag.lastIndex;
  }
  return tags;
}
const tags = readPage(read("site/index.html"));
const start = tags.slice(0, 4);
if (start.length < 4 || start[0].name !== "html" || start[1].name !== "head" ||
    start[2].name !== "meta" || start[2].attributes.charset !== "utf-8" ||
    start[3].name !== "meta" || start[3].attributes["http-equiv"] !== "Content-Security-Policy" || start[3].attributes.content !== policy)
  fail("site/index.html", "the reviewed content policy must be the first element after the character set");
for (const [index, tag] of tags.entries()) {
  const {name, attributes:given} = tag, here = "site/index.html";
  if (!elements.includes(name)) fail(here, "<" + name + "> is not a reviewed element");
  for (const key of Object.keys(given))
    if (!attributes.includes(key) && !/^(?:aria|data)-[a-z-]+$/.test(key)) fail(here, "attribute " + key + " is not reviewed in " + tag.text);
  if ("http-equiv" in given && index !== 3) fail(here, "only the content policy may use http-equiv");
  if (name === "script" && (Object.keys(given).sort().join() !== "defer,src")) fail(here, "scripts must be deferred local files: " + tag.text);
  if (name === "link" && (given.rel !== "stylesheet" || Object.keys(given).sort().join() !== "href,rel")) fail(here, "only a local stylesheet link is allowed");
  if (name === "meta" && "name" in given && !["viewport", "color-scheme", "description", "referrer"].includes(given.name)) fail(here, "meta " + given.name + " is not reviewed");
  if (name === "form" && Object.keys(given).join() !== "id") fail(here, "forms must not post anywhere");
  if ("src" in given && !["script", "img"].includes(name)) fail(here, "src on <" + name + ">");
  if ("href" in given && !["a", "link"].includes(name)) fail(here, "href on <" + name + ">");
  for (const key of ["src", "href"]) {
    const value = given[key];
    if (value === undefined) continue;
    if (name === "a" && /^#[a-z][a-z0-9-]*$/.test(value)) continue;
    if (/^\.\/[a-z0-9][a-z0-9./-]*$/.test(value) && name !== "a") {
      if (!siteFiles.includes(value.slice(2))) fail(here, "missing local file " + value);
    } else if (name === "a" && value.startsWith("https://") && linkHosts.includes(hostOf(value))) {
      const rel = (given.rel || "").split(/\s+/);
      if (given.target !== "_blank" || !rel.includes("noopener") || !rel.includes("noreferrer")) fail(here, "outbound link needs target and rel noopener noreferrer: " + value);
    } else fail(here, "unreviewed address " + value);
  }
  if (name === "a" && "target" in given && !/\bnoopener\b/.test(given.rel || "")) fail(here, "target without noopener in " + tag.text);
}
if (!tags.some(tag => tag.name === "meta" && tag.attributes.name === "referrer" && tag.attributes.content === "no-referrer"))
  fail("site/index.html", "referrer policy is missing");

// 3. Scripts and styles: no risky browser calls, no unreviewed hosts, no remote styles.
for (const file of siteFiles.filter(name => /\.(?:js|css)$/.test(name))) {
  const text = read("site/" + file);
  for (const call of browserCalls) if (call.test(text)) fail("site/" + file, "uses " + call.source);
  for (const address of addresses(text))
    if (!isNamespace(address) && !(address.secure && scriptHosts.includes(address.host))) fail("site/" + file, "unreviewed address " + address.text);
  if (file.endsWith(".js")) {
    if (/\bfetch\b/.test(text) && file !== "repository.js") fail("site/" + file, "only repository.js may make a request");
    for (const [made] of text.matchAll(/createElement\s*\([^)]*\)/g))
      if (!['createElement("a")', 'createElement("canvas")'].includes(made)) fail("site/" + file, "creates an unreviewed element: " + made);
  } else {
    if (/@import|expression\s*\(|\\/i.test(text)) fail("site/" + file, "@import, expression() and escapes are not allowed");
    for (const [, target] of text.matchAll(/url\(\s*["']?([^"')]+)/gi))
      if (!siteFiles.includes(target)) fail("site/" + file, "unreviewed url(" + target + ")");
  }
}

// 4. Images carry pixels only: no text, time, colour-profile or location chunks, and nothing after the end marker.
function checkImage(file) {
  const bytes = readFileSync(path.join(root, file));
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return fail(file, "not a PNG");
  let offset = 8, ended = false;
  while (offset + 12 <= bytes.length && !ended) {
    const chunk = bytes.toString("latin1", offset + 4, offset + 8);
    if (!["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(chunk)) fail(file, "metadata chunk " + chunk);
    ended = chunk === "IEND";
    offset += 12 + bytes.readUInt32BE(offset);
  }
  if (!ended || offset !== bytes.length) fail(file, "data after the end of the image, or a broken image");
}

// 5. Every file in the repository: no personal details, credentials or unreviewed hosts, in contents or names.
const credential = [
  ["gh", "[pousr]_[A-Za-z0-9]{20,}"], ["github", "_pat_[A-Za-z0-9_]{20,}"], ["AK", "IA[0-9A-Z]{16}"],
  ["-----BEGIN", " [A-Z ]*PRIVATE KEY-----"], ["xox", "[abprs]-[A-Za-z0-9-]{10,}"], ["sk", "-[A-Za-z0-9_-]{24,}"],
  ["AIza", "[0-9A-Za-z_-]{30,}"]
].map(parts => new RegExp(parts.join("")));
// The look-behind makes a match start only at the beginning of a run, so long unbroken text stays linear.
const emailAddress = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// Unix-style folders are matched in their exact case, so GitHub's lowercase /users/ address path is not caught.
const homeFolder = new RegExp("(?:" + ["/Use" + "rs/", "/ho" + "me/", "/Volu" + "mes/", "/var/fold" + "ers/", "-Use" + "rs-", "~/"].join("|") +
  ")[A-Za-z0-9._-]+|[A-Za-z]:[\\\\/][Uu]se" + "rs[\\\\/][A-Za-z0-9._-]+");
const networkAddress = /\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/;
const localHost = /\b[A-Za-z0-9-]+\.(?:local|lan|internal|localdomain)\b/i;
const termsFile = process.env.PRIVATE_TERMS_FILE;
if (termsFile && !existsSync(termsFile)) fail("PRIVATE_TERMS_FILE", "is set but the file does not exist");
const privateTerms = termsFile && existsSync(termsFile)
  ? readFileSync(termsFile, "utf8").split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => line && !line.startsWith("#"))
  : [];
const everything = walk(".");
for (const file of everything) {
  const size = statSync(path.join(root, file)).size, lowerName = file.toLowerCase();
  if (size > 2 * 1024 * 1024) fail(file, "larger than 2 MB");
  for (const term of privateTerms) if (lowerName.includes(term)) fail(file, "file name contains a private term");
  if (!textTypes.test(file)) {
    if (!file.startsWith("site/") || !/\.(?:png|woff2)$/.test(file)) fail(file, "images, fonts and other binary files are allowed only in site/");
    else if (file.endsWith(".png")) checkImage(file);
    continue;
  }
  const text = read(file), lower = text.toLowerCase();
  for (const pattern of credential) if (pattern.test(text)) fail(file, "looks like a credential");
  // Addresses are judged by host below, and git@github.com is the public clone prefix, so neither counts as an email.
  if (emailAddress.test(text.replace(addressPattern, " ").replaceAll("git@github.com", " "))) fail(file, "contains an email address");
  if (homeFolder.test(text)) fail(file, "contains a home or system folder path");
  if (networkAddress.test(text)) fail(file, "contains a network address");
  if (localHost.test(text)) fail(file, "contains a local network name");
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
