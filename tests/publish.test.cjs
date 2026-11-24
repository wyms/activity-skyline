const test = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const path = require("node:path");

test("the publish checks pass for the site as committed", () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, "../tools/check.mjs")], {encoding:"utf8", env:{PATH:process.env.PATH}});
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
