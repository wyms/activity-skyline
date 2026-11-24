"use strict";

(() => {
  // GitHub Pages cannot send a frame-ancestors header, so the studio refuses to run inside another site's frame.
  if (window.top !== window.self) { document.documentElement.hidden = true; return; }
  const el = id => document.getElementById(id);
  const controls = selector => [...document.querySelectorAll(selector)];
  const number = value => value.toLocaleString("en-US");
  const currentYear = new Date().getUTCFullYear();
  const example = SkylineCalendar.calendar(SkylineExample);
  const initial = example;
  const sourceInput = el("source-input"), yearInput = el("year"), labelInput = el("label");
  const modeButtons = controls("[data-mode]"), deliveryButtons = controls("[data-delivery]");
  const viewButtons = controls("[data-view]"), layoutButtons = controls("[data-layout]");
  const remembered = {repo:example.source, profile:""};
  const scene = el("model-view");
  const viewer = new SkylineViewer.Viewer(scene, el("canvas-fallback"));
  let mode = "profile", delivery = "files", finish = "Evergreen", layout = "assembled";
  let shape = document.querySelector('input[name="shape"]:checked').value;
  let data = null, model = null, exampleShown = true, dirty = false, loading = false;
  let customLabel = false, labelSource = "", labelValid = true, exporting = false;
  let generation = 0, controller = null, labelTimer = null;
  yearInput.replaceChildren();
  for (let year = Math.max(currentYear, initial.year); year >= 2008; year--) yearInput.add(new Option(String(year), String(year)));
  yearInput.value = String(initial.year);
  sourceInput.value = initial.source;

  function message(id, text, error = false) {
    const node = el(id);
    node.textContent = text;
    node.classList.toggle("error", error);
  }
  function press(buttons, key, selected) {
    buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset[key] === selected)));
  }
  function refreshActions() {
    const unavailable = !model || !labelValid || dirty || loading || exporting || labelTimer !== null;
    el("download-color").disabled = unavailable;
    el("download-stl").disabled = unavailable;
    el("export").disabled = unavailable;
    el("save-image").disabled = unavailable || !el("canvas-fallback").hidden;
    el("load").disabled = loading;
    el("load").setAttribute("aria-busy", String(loading));
    el("load-text").textContent = loading ? "Generating…" : "Generate skyline";
  }
  function updateDimensions() {
    if (!model) return;
    const dimensions = SkylineMesh.layout(model, layout);
    el("dimensions").textContent = [dimensions.width, dimensions.depth, dimensions.height]
      .map(value => +value.toFixed(1)).join(" × ") + " mm";
  }
  function drawCalendar() {
    if (!data) return;
    const canvas = el("activity-calendar");
    let context;
    try { context = canvas.getContext("2d"); } catch { return; }
    if (!context) return;
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(bounds.width * scale), height = Math.round(bounds.height * scale);
    if (!width || !height) return;
    canvas.width = width; canvas.height = height;
    const cellW = width / data.weeks.length, cellH = height / 7, gap = Math.max(1, Math.round(scale));
    const ink = SkylineViewer.finishes[finish].map(v => Math.round(v * 255));
    const paper = [225,230,215], peak = Math.log1p(data.peak) || 1;
    data.weeks.forEach((week, column) => week.forEach((count, row) => {
      const strength = count ? .29 + .71 * Math.log1p(count) / peak : 0;
      context.fillStyle = "rgb(" + paper.map((v,i) => Math.round(v + (ink[i] - v) * strength)).join(",") + ")";
      const x = Math.round(column * cellW), y = Math.round(row * cellH);
      context.fillRect(x, y, Math.max(1, Math.round((column+1)*cellW) - x - gap),
        Math.max(1, Math.round((row+1)*cellH) - y - gap));
    }));
  }
  function buildModel() {
    if (labelTimer !== null) { clearTimeout(labelTimer); labelTimer = null; }
    try {
      model = SkylineMesh.createModel({weeks:data.weeks, label:labelInput.value, year:data.year, style:shape});
      labelValid = !labelInput.value.trim() || Boolean(model.label);
      message("label-hint", labelValid ? "Up to 24 characters. The year is engraved alongside." :
        "Use supported letters or digits, or clear the field to engrave just the year.", !labelValid);
      el("inscription-proof").textContent = model.engravedText;
      scene.setAttribute("aria-label", data.source + ", " + data.year + ". " + data.active +
        " active days. Drag or use arrow keys to rotate. Plus and minus zoom. Shift-drag or Shift-arrow keys pan when zoomed. Home resets the camera.");
      viewer.setModel(model);
      updateDimensions();
    } catch (error) {
      model = null; message("stl-status", error.message || "Couldn’t build that model.", true);
    }
    refreshActions();
  }
  // linked: the source was read from GitHub or typed as a handle, so its name may link there. Local files never link.
  function showData(next, isExample, linked = false) {
    const nextSource = [next.kind, next.source, next.contributor].join("/").toLowerCase();
    if (customLabel && labelSource && labelSource !== nextSource) customLabel = false;
    labelSource = nextSource;
    data = next; exampleShown = isExample; dirty = false; loading = false;
    if (!customLabel) labelInput.value = SkylineRepository.defaultLabel(data).slice(0, SkylineMesh.labelLimit);
    const poster = el("sample-poster");
    poster.hidden = !isExample || customLabel || shape !== "contour" || finish !== "Evergreen";
    const sourceTag = el("source-tag"), sourceName = data.source || "Local activity";
    const sourcePath = linked && /^[\w.-]+(\/[\w.-]+)?$/.test(data.source || "") ? data.source : "";
    if (sourcePath) {
      const link = document.createElement("a");
      link.href = "https://github.com/" + sourcePath; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = sourceName; link.title = "Open on GitHub";
      sourceTag.replaceChildren(link, data.contributor ? " · @" + data.contributor : "");
    } else sourceTag.textContent = sourceName + (data.contributor ? " · @" + data.contributor : "");
    el("example-tag").hidden = !isExample;
    el("preview-year").textContent = data.year;
    el("calendar-year").textContent = data.year;
    el("total-count").textContent = number(data.total);
    el("active-days").textContent = number(data.active);
    el("peak-count").textContent = number(data.peak);
    el("count-title").textContent = data.kind === "repo" ? "Commits" : "Contributions";
    el("activity-calendar").setAttribute("aria-label", data.year + " activity, " + data.active + " active days and " + data.total + " total.");
    message("stl-status", "");
    message("export-status", kitDescription());
    layout = "assembled"; press(layoutButtons, "layout", layout);
    viewer.setLayout(layout);
    buildModel(); drawCalendar(); viewer.reset();
  }
  function interrupt() {
    generation++;
    controller?.abort();
    controller = null; loading = false;
  }
  function revealOnPhone() {
    if (!window.matchMedia?.("(max-width:720px)").matches) return;
    if (el("source-form").contains(document.activeElement)) document.activeElement.blur();
    requestAnimationFrame(() => el("preview").scrollIntoView?.({
      block:"start", behavior:window.matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth"
    }));
  }
  function profileTarget() {
    let source;
    try { source = SkylineRepository.sourceFrom(sourceInput.value); } catch { return null; }
    if (source.kind !== "profile") return null;
    const target = {name:source.name, year:Number(yearInput.value)};
    try { target.address = SkylineProfilePage.address(target.name, target.year); } catch { return null; }
    return target;
  }
  function refreshProfileSteps() {
    const link = el("calendar-link"), target = mode === "profile" ? profileTarget() : null;
    el("profile-steps").hidden = mode !== "profile";
    el("calendar-file").disabled = !target;
    if (target) {
      link.href = target.address;
      link.textContent = "Open the " + target.year + " calendar for @" + target.name + " on GitHub";
      link.removeAttribute("aria-disabled");
    } else {
      link.removeAttribute("href");
      link.textContent = "Enter a GitHub handle above";
      link.setAttribute("aria-disabled", "true");
    }
  }
  function markDirty() {
    interrupt(); dirty = true;
    message("source-status", "");
    message("stl-status", mode === "file" ? "Load an activity file to download the new model." :
      mode === "profile" ? "Generate the selected profile to update this model." :
      "Generate the selected repository to update this model.");
    message("export-status", "Generate the selected model before downloading its kit.");
    refreshProfileSteps();
    refreshActions();
  }
  function selectMode(next, pastedValue) {
    if (next === mode) return;
    if (mode !== "file" && pastedValue === undefined) remembered[mode] = sourceInput.value;
    mode = next; press(modeButtons, "mode", mode);
    el("source-form").hidden = mode === "file";
    el("file-fields").hidden = mode !== "file";
    el("author-field").hidden = mode !== "repo";
    el("file").value = ""; el("calendar-file").value = "";
    if (mode !== "file") {
      sourceInput.value = pastedValue ?? remembered[mode];
      sourceInput.placeholder = mode === "repo" ? "https://github.com/owner/repo" : "octocat or github.com/octocat";
      sourceInput.inputMode = mode === "repo" ? "url" : "text";
    }
    markDirty();
  }
  modeButtons.forEach(button => button.addEventListener("click", () => selectMode(button.dataset.mode)));
  function matchSourceTab() {
    let source;
    try { source = SkylineRepository.sourceFrom(sourceInput.value); } catch { return; }
    selectMode(source.kind, sourceInput.value);
  }
  sourceInput.addEventListener("input", event => {
    markDirty();
    if (event.inputType === "insertFromPaste") matchSourceTab();
  });
  sourceInput.addEventListener("change", matchSourceTab);
  el("author").addEventListener("input", markDirty);
  yearInput.addEventListener("change", markDirty);

  function readSource(source, year, requestId, signal) {
    return SkylineRepository.read({source:source.name, year, author:el("author").value, signal, onProgress:count => {
      if (requestId === generation) message("source-status", "Read " + number(count) + " commits…");
    }});
  }
  el("source-form").addEventListener("submit", async event => {
    event.preventDefault();
    const value = sourceInput.value.trim();
    markDirty();
    let source;
    try { source = SkylineRepository.sourceFrom(value); }
    catch (error) { message("source-status", error.message, true); return; }
    selectMode(source.kind, value);
    remembered[source.kind] = value;
    const requestId = generation;
    const year = Number(yearInput.value), profile = source.kind === "profile";
    controller = new AbortController();
    loading = true; refreshActions();
    message("source-status", profile ? "Looking up the " + year + " calendar for @" + source.name + "…" :
      "Reading the selected year from GitHub…");
    try {
      const payload = profile ? await SkylineProfileLookup.read({name:source.name, year, signal:controller.signal}) :
        await readSource(source, year, requestId, controller.signal);
      if (requestId !== generation) return;
      const next = SkylineCalendar.calendar(payload);
      showData(next, false, true);
      message("source-status", next.active ? "Model generated for " + (profile ? "@" : "") + next.source + "." :
        "This year has zero activity. The STL contains the engraved base and end cap.");
      revealOnPhone();
    } catch (error) {
      if (requestId !== generation) return;
      message("source-status", error.message || "Couldn’t read this source.", true);
      // The saved-page route still works when the lookup service does not.
      if (error.name === "ProfileLookupUnavailable") el("manual-steps").open = true;
    } finally {
      if (requestId === generation) { loading = false; controller = null; refreshActions(); }
    }
  });
  el("restore").addEventListener("click", () => {
    interrupt(); selectMode("repo");
    sourceInput.value = "https://github.com/" + example.source;
    remembered.repo = sourceInput.value; yearInput.value = String(example.year);
    el("author").value = ""; el("file").value = ""; customLabel = false;
    showData(example, true, true);
    message("source-status", "Loaded the included Vite repository snapshot.");
    revealOnPhone();
  });
  el("file").addEventListener("change", async () => {
    const file = el("file").files[0];
    markDirty();
    if (!file) return;
    if (file.size > 1024*1024) { message("source-status", "Choose a daily activity file smaller than 1 MiB.", true); return; }
    const requestId = generation;
    loading = true; refreshActions();
    try {
      const imported = SkylineCalendar.importFile(await file.text());
      if (requestId !== generation) return;
      if (!imported.source) imported.source = SkylineCalendar.clean(file.name.replace(/\.(csv|json)$/i, ""), 160);
      showData(imported, false);
      message("source-status", imported.active ? "Model generated from your local file." : "This file has zero activity. The STL contains the engraved base and end cap.");
      revealOnPhone();
    } catch (error) {
      if (requestId === generation) message("source-status", error.message, true);
    } finally {
      if (requestId === generation) { loading = false; refreshActions(); }
    }
  });
  el("calendar-file").addEventListener("change", async () => {
    const picker = el("calendar-file"), file = picker.files[0];
    markDirty();
    if (!file) return;
    const target = profileTarget();
    if (!target) { message("source-status", "Enter the GitHub handle this calendar belongs to.", true); return; }
    if (file.size > SkylineProfilePage.maxLength) {
      message("source-status", "Choose the calendar page saved from GitHub. It is smaller than 8 MB.", true); return;
    }
    const requestId = generation;
    loading = true; refreshActions();
    try {
      const days = SkylineProfilePage.read(await file.text(), target.year);
      if (requestId !== generation) return;
      const next = SkylineCalendar.calendar({source:target.name, year:target.year, kind:"profile", days});
      showData(next, false, true);
      message("source-status", next.active ? "Model generated from the saved calendar for @" + next.source + "." :
        "This calendar has zero activity. The STL contains the engraved base and end cap.");
      revealOnPhone();
    } catch (error) {
      if (requestId === generation) message("source-status", error.message || "Couldn’t read that saved page.", true);
    } finally {
      if (requestId === generation) { loading = false; refreshActions(); }
      picker.value = "";
    }
  });
  labelInput.addEventListener("input", () => {
    customLabel = true;
    if (dirty) labelSource = "";
    el("sample-poster").hidden = true;
    clearTimeout(labelTimer);
    labelTimer = setTimeout(buildModel, 140);
    message("stl-status", ""); refreshActions();
  });
  controls('input[name="shape"]').forEach(input => input.addEventListener("change", () => {
    if (input.checked) {
      shape = input.value; el("sample-poster").hidden = true;
      message("stl-status", ""); buildModel();
    }
  }));
  controls('input[name="finish"]').forEach(input => input.addEventListener("change", () => {
    if (input.checked) {
      finish = input.value; el("sample-poster").hidden = true;
      viewer.setFinish(finish); drawCalendar();
    }
  }));

  viewButtons.forEach(button => button.addEventListener("click", () => viewer.setView(button.dataset.view)));
  layoutButtons.forEach(button => button.addEventListener("click", () => {
    layout = button.dataset.layout;
    press(layoutButtons, "layout", layout); el("sample-poster").hidden = true;
    viewer.setLayout(layout); updateDimensions();
  }));
  el("zoom-in").addEventListener("click", () => viewer.zoomBy(1.2));
  el("zoom-out").addEventListener("click", () => viewer.zoomBy(1/1.2));
  el("reset-view").addEventListener("click", () => viewer.reset());
  scene.addEventListener("modeldrawn", () => { el("sample-poster").hidden = true; });
  scene.addEventListener("viewchange", event => {
    const {view, zoom} = event.detail;
    press(viewButtons, "view", view);
    el("reset-view").textContent = Math.round(zoom * 100) + "%";
    el("zoom-in").disabled = zoom >= 2.399; el("zoom-out").disabled = zoom <= .701;
  });
  el("guide-link").addEventListener("click", () => { el("print-guide").open = true; });
  if (typeof ResizeObserver === "function") new ResizeObserver(drawCalendar).observe(el("activity-calendar"));
  else window.addEventListener("resize", drawCalendar);

  function save(filename, blob) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
  function basename() {
    const slug = (model.label || "skyline").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skyline";
    return (exampleShown ? "example-" : "") + slug + "-" + data.year + (shape === "contour" ? "-contour" : "");
  }
  el("save-image").addEventListener("click", async () => {
    if (el("save-image").disabled) return;
    const selected = model, selectedFinish = finish, identifier = generation, filename = basename() + ".png";
    exporting = true; refreshActions(); message("stl-status", "Rendering the current view…");
    try {
      const bytes = await viewer.proofPNG({currentView:true});
      if (!bytes) throw new Error("This browser couldn’t save a PNG.");
      if (selected !== model || identifier !== generation || selectedFinish !== finish || labelTimer !== null) return;
      save(filename, new Blob([bytes], {type:"image/png"}));
      message("stl-status", "Saved " + filename + ".");
    } catch (error) { message("stl-status", error.message || "Couldn’t save this view.", true); }
    finally {
      exporting = false; refreshActions();
      if (el("stl-status").textContent === "Rendering the current view…") message("stl-status", "");
    }
  });
  el("download-color").addEventListener("click", () => {
    if (el("download-color").disabled) return;
    try {
      const bytes = SkylineKit.colorPlate(model, SkylineMesh, finish);
      save(basename() + ".3mf", new Blob([bytes], {type:"model/3mf"}));
      message("stl-status", "Prepared a 3MF with charcoal and " + finish + " PLA.");
    } catch (error) { message("stl-status", error.message, true); }
  });
  el("download-stl").addEventListener("click", () => {
    if (el("download-stl").disabled) return;
    try {
      const filename = basename() + ".stl";
      const bytes = SkylineKit.printPlate(model, SkylineMesh);
      save(filename, new Blob([bytes], {type:"model/stl"}));
      message("stl-status", "Prepared " + filename + " · " + (bytes.byteLength / 1_000_000).toFixed(2) + " MB.");
    } catch (error) { message("stl-status", error.message || "Couldn’t create the STL.", true); }
  });
  el("example-file").addEventListener("click", () => {
    const rows = Object.entries(SkylineExample.days).map(([day,count]) => day + "," + count);
    save("vite-" + example.year + "-activity.csv", new Blob(["date,count\r\n" + rows.join("\r\n") + "\r\n"], {type:"text/csv"}));
  });
  function kitDescription() {
    return delivery === "physical" ? "STLs, image proof and a U.S. supplier quote request." : "ZIP with individual STL files in millimeters.";
  }
  deliveryButtons.forEach(button => button.addEventListener("click", () => {
    delivery = button.dataset.delivery; press(deliveryButtons, "delivery", delivery);
    el("physical-fields").hidden = delivery !== "physical";
    el("export").textContent = delivery === "physical" ? "Download print request" : "Download print kit";
    message("export-status", dirty ? "Generate the selected model before downloading its kit." : kitDescription());
  }));
  el("export").addEventListener("click", async () => {
    if (el("export").disabled) return;
    const selected = model, selectedFinish = finish, physical = delivery === "physical";
    const identifier = generation;
    const filename = basename() + (physical ? "-print-request.zip" : "-print-kit.zip");
    const options = {finish, physical, isSample:false, quantity:el("quantity").valueAsNumber, zipCode:el("destination").value.trim()};
    exporting = true; refreshActions(); message("export-status", "Preparing the print files and image proof…");
    try {
      try { options.proof = await viewer.proofPNG(); } catch { options.proof = null; }
      if (selected !== model || identifier !== generation || selectedFinish !== finish || physical !== (delivery === "physical") || labelTimer !== null) return;
      const bytes = SkylineKit.makeKit(selected, data, options, SkylineMesh);
      save(filename, new Blob([bytes], {type:"application/zip"}));
      message("export-status", "Prepared " + filename + ".");
    } catch (error) { message("export-status", error.message || "Couldn’t prepare the printable files.", true); }
    finally {
      exporting = false; refreshActions();
      if (el("export-status").textContent === "Preparing the print files and image proof…") message("export-status", kitDescription());
    }
  });
  selectMode("repo", example.source);
  showData(example, true, true);
})();
