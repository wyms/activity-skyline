const test = require("node:test");
const assert = require("node:assert/strict");
const {sourceFrom, nameFrom, defaultLabel, read} = require("../site/repository.js");
const geometry = require("../site/mesh.js");
const {calendar} = require("../site/calendar.js");
const {printPlate} = require("../site/kit.js");

const tip = "e".repeat(40);
const dated = (id, date) => ({sha:id.toString(16).padStart(40, "0"), commit:{committer:{date}}});
const response = (items, headers = {}, status = 200) => new Response(JSON.stringify(items), {status, headers});

test("the same GitHub input recognizes handles, profile URLs and repository URLs", () => {
  for (const entry of ["octocat", "@octocat", "github.com/octocat", "https://github.com/octocat", "https://www.github.com/octocat/?tab=repositories"])
    assert.deepEqual(sourceFrom(entry), {kind:"profile", name:"octocat"});
  for (const entry of ["octocat/project", "https://github.com/octocat/project/", "git@github.com:octocat/project.git"])
    assert.deepEqual(sourceFrom(entry), {kind:"repo", name:"octocat/project"});
  for (const entry of ["https://elsewhere.test/octocat","https://github.com@elsewhere.test/octocat","git@github.com:octocat","https://github.com/"])
    assert.throws(() => sourceFrom(entry));
});

test("the default inscription is the profile handle, selected contributor, or repository owner", () => {
  assert.equal(defaultLabel({source:"octocat"}),"octocat");
  assert.equal(defaultLabel({source:"https://github.com/octocat/project"}),"octocat");
  assert.equal(defaultLabel({source:"OtherOrg/team-repo", contributor:"@one-person"}),"one-person");
  assert.equal(defaultLabel({source:"local-checkout", owner:"octocat"}),"octocat");
  assert.equal(defaultLabel({source:"My imported calendar"}),"My imported calendar");
  assert.equal(defaultLabel({source:""}),"");
});

test("public repository URLs, pasted clone URLs and short names normalize to one GitHub path", () => {
  for (const url of ["https://github.com/vitejs/vite", "https://www.github.com/vitejs/vite.git/",
    "github.com/vitejs/vite", "git@github.com:vitejs/vite.git", "vitejs/vite"])
    assert.equal(nameFrom(url), "vitejs/vite");
  for (const url of ["https://gitlab.com/o/r", "https://github.com@elsewhere.test/o/r",
    "https://name:password@github.com/o/r", "https://github.com/o/r/tree/main", "org/..", "name", "one/two/three"])
    assert.throws(() => nameFrom(url));
});

test("the browser import pins HEAD, retains its contributor filter, deduplicates commits and groups by UTC", async () => {
  const routes = [], first = dated(1, "2024-12-31T23:15:00-01:00");
  const request = async (url, options) => {
    routes.push(new URL(url));
    assert.equal(options.credentials, "omit");
    if (routes.length === 1) return response([{sha:tip}]);
    if (routes.length === 2) return response([first, dated(2,"2025-12-31T23:59:59Z")], {link:'<ignored>; rel="next"'});
    return response([first, dated(3,"2026-01-01T00:00:00Z")]);
  };
  const result = await read({source:"https://github.com/team/project.git", year:2025, author:"@someone", request});
  assert.deepEqual(result.days, {"2025-01-01":1,"2025-12-31":1});
  assert.equal(result.contributor, "someone");
  assert.equal(routes[0].searchParams.has("author"),false);
  for (const url of routes.slice(1)) {
    assert.equal(url.origin,"https://api.github.com");
    assert.equal(url.pathname,"/repos/team/project/commits");
    assert.equal(url.searchParams.get("sha"),tip);
    assert.equal(url.searchParams.get("author"),"someone");
  }
  assert.equal(routes[2].searchParams.get("page"), "2");
});

test("a full page with hidden Link headers is followed through the final partial page", async () => {
  const calls = [];
  async function request(url) {
    calls.push(url);
    if (calls.length === 1) return response([{sha:tip}]);
    if (calls.length === 2) return response(Array.from({length:100}, (_,i) => dated(i,"2025-03-01T12:00:00Z")));
    return response([dated(100,"2025-03-02T12:00:00Z")]);
  }
  const result = await read({source:"team/project", year:2025, request});
  assert.equal(calls.length, 3);
  assert.deepEqual(result.days, {"2025-03-01":100,"2025-03-02":1});
});

test("an empty branch yields a printable base; later rate limits and bad dates reject the whole import", async () => {
  const options = {source:"team/project", year:2025};
  const empty = await read({...options, request:async () => response({message:"Git Repository is empty."},{},409)});
  assert.deepEqual(empty.days, {});
  const fetchPages = (...pages) => async () => pages.shift();
  await assert.rejects(read({...options, request:fetchPages(response([{sha:tip}]),
    response([dated(1,"2025-01-01T09:00:00Z")], {link:'<next>; rel="next"'}), response({},{},429))}), /limited/);
  await assert.rejects(read({...options, request:fetchPages(response([{sha:tip}]),
    response([dated(1,"2025-01-01")]))}), /date/);
  await assert.rejects(read({...options, author:"name/extra", request:() => assert.fail()}), /username/);
});

test("the direct STL contains the exact preview facets with the cap in the displayed print-bed position", () => {
  const input = calendar({year:2025, days:{"2025-03-02":9,"2025-09-02":3}});
  for (const style of ["towers","contour"]) {
    const model = geometry.createModel({...input, label:"Plate", style});
    const actual = Buffer.from(printPlate(model, geometry));
    const body = Buffer.from(geometry.toSTL(model.body));
    const {capOffset, depth, width} = geometry.layout(model, "plate");
    assert.deepEqual([width,depth,capOffset], [175.5,78,[0,41,0]]);
    assert.equal(actual.readUInt32LE(80), model.body.length + model.cap.length);
    assert.deepEqual(actual.subarray(84,body.length), body.subarray(84));
    model.cap.forEach((face,i) => face.forEach((point,k) => point.forEach((n,axis) => {
      const offset = body.length + i*50 + 12 + k*12 + axis*4;
      assert.equal(actual.readFloatLE(offset), Math.fround(n + capOffset[axis]));
    })));
  }
});
