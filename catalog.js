import {
  $,
  escapeHtml,
  effectiveSourceSizeFromTransform,
  getChromeInsets,
  lockWindowToAspect
} from "./utils.js";
import {
  createWindow,
  addWindowState,
  hasWindow,
  getWindowById
} from "./windowManager.js";
import { getActiveSceneName } from "./obsClient.js";
import { findOwningSceneAndItemId, scheduleSync } from "./sync.js";

let obs = null;
let cachedInputs = [];
let selectedEntry = null;
let selectedCardEl = null;

// wired from main.js so we can toggle button + title
let _sourceCreateBtn = null;
let _sourceCustomTitle = null;

export function attachOBSForCatalog(obsClient) {
  obs = obsClient;
}

export function wireCatalogUI({
  sourceDialog,
  sourceGrid,
  sourceHint,
  sourceRefreshBtn,
  sourceCreateBtn,
  sourceCancelBtn,
  sourceCustomTitle,
  taskbarTabs,
  desktop,
  tplWin
}) {
  _sourceCreateBtn = sourceCreateBtn;
  _sourceCustomTitle = sourceCustomTitle;

  if (_sourceCreateBtn) _sourceCreateBtn.disabled = true;

  // Refresh list
  sourceRefreshBtn?.addEventListener("click", () =>
    renderSourceCatalog({ sourceGrid, sourceHint }).catch(
      (e) => (sourceHint.textContent = e.message)
    )
  );

  // Create window from selected card
  sourceCreateBtn?.addEventListener("click", async () => {
    if (!selectedEntry) return;
    const titleOverride =
      (_sourceCustomTitle?.value || "").trim() || selectedEntry.name;

    await createSourceWindow(selectedEntry.name, {
      titleOverride,
      taskbarTabs,
      desktop,
      tplWin,
      sourceDialog,
      restore: null,
      // NEW: pass through the exact scene + item we clicked
      selectedSceneName: selectedEntry.sceneName,
      selectedSceneItemId: selectedEntry.sceneItemId
    });
  });

  // Cancel picker
  sourceCancelBtn?.addEventListener("click", () => {
    const hostWin = sourceDialog.closest(".win");
    if (hostWin) hostWin.querySelector(".win-close").click();
  });
}

async function renderSourceCatalog({ sourceGrid, sourceHint }) {
  sourceGrid.innerHTML = "";
  selectedEntry = null;
  if (selectedCardEl) {
    selectedCardEl.classList.remove("selected");
    selectedCardEl = null;
  }
  if (_sourceCreateBtn) _sourceCreateBtn.disabled = true;
  if (_sourceCustomTitle) _sourceCustomTitle.value = "";

  if (!obs?.connected) {
    sourceHint.textContent = "Connect to OBS to list scene sources.";
    return;
  }

  // Build input kind lookup once
  if (!cachedInputs.length) cachedInputs = await obs.getInputs();
  const kindByName = new Map(
    cachedInputs.map((i) => [i.inputName, (i.inputKind || "").toLowerCase()])
  );

  // Active scene items
  const sceneName = await getActiveSceneName(obs);
  const items = await obs.request("GetSceneItemList", { sceneName });

  let entries = (Array.isArray(items?.sceneItems) ? items.sceneItems : [])
    .map((it) => ({
      name: it?.sourceName || "",
      sceneItemId: it?.sceneItemId,
      kind: (kindByName.get(it?.sourceName || "") || "").toLowerCase(),
      sceneName // ← keep which scene this came from
    }))
    .filter((e) => e.name);

  // Hide this UI if it's running as a Browser Source in OBS
  const IGNORE_SELF = true;
  if (IGNORE_SELF && window.location?.href) {
    const here = window.location.href.replace(/\/+$/, "");
    const filtered = [];
    for (const e of entries) {
      if (e.kind === "browser_source") {
        try {
          const settings = await obs.request("GetInputSettings", {
            inputName: e.name
          });
          const url = (settings?.inputSettings?.url || "")
            .trim()
            .replace(/\/+$/, "");
          if (url && url === here) continue;
        } catch {
          // ignore, keep entry
        }
      }
      filtered.push(e);
    }
    entries = filtered;
  }

  if (!entries.length) {
    sourceHint.textContent = `No sources found in scene "${sceneName}".`;
    return;
  }

  sourceHint.textContent = `${entries.length} source${
    entries.length === 1 ? "" : "s"
  } in scene "${sceneName}".`;

  for (const it of entries) {
    const card = document.createElement("div");
    card.className = "source-card";
    card.innerHTML = `
      <div class="sc-icon">${iconForKind(it.kind)}</div>
      <div class="sc-title" title="${escapeHtml(it.name)}">${escapeHtml(
        it.name
      )}</div>
      <div class="sc-kind">${prettyKind(it.kind)}</div>
    `;
    card.addEventListener("click", () => {
      if (selectedCardEl) selectedCardEl.classList.remove("selected");
      selectedCardEl = card;
      selectedCardEl.classList.add("selected");
      selectedEntry = it;

      if (_sourceCreateBtn) _sourceCreateBtn.disabled = false;
      if (
        _sourceCustomTitle &&
        !_sourceCustomTitle.value.trim()
      ) {
        _sourceCustomTitle.value = it.name;
      }
    });
    sourceGrid.appendChild(card);
  }
}

function prettyKind(kind) {
  if (!kind) return "Source";
  if (kind.includes("browser_source")) return "Browser Source";
  if (
    kind.includes("monitor") ||
    kind.includes("display") ||
    kind.includes("screen")
  )
    return "Display Capture";
  if (kind.includes("window")) return "Window Capture";
  if (kind.includes("dshow") || kind.includes("v4l")) return "Video Device";
  if (kind.includes("decklink")) return "DeckLink";
  if (kind.includes("ndi")) return "NDI Source";
  if (kind.includes("av_capture")) return "AV Capture";
  if (kind.includes("game")) return "Game Capture";
  return kind || "Source";
}

function iconForKind(kind) {
  if (!kind) return "🎛️";
  if (kind.includes("browser_source")) return "🌐";
  if (
    kind.includes("monitor") ||
    kind.includes("display") ||
    kind.includes("screen")
  )
    return "🖥️";
  if (kind.includes("window")) return "🪟";
  if (kind.includes("dshow") || kind.includes("v4l")) return "📷";
  if (kind.includes("decklink")) return "🎞️";
  if (kind.includes("ndi")) return "🌐";
  if (kind.includes("av_capture")) return "🎥";
  if (kind.includes("game")) return "🎮";
  return "🎛️";
}

export async function createSourceWindow(
  sourceName,
  {
    titleOverride,
    taskbarTabs,
    desktop,
    tplWin,
    sourceDialog,
    restore,
    selectedSceneName,
    selectedSceneItemId
  }
) {
  // If we're restoring and the window already exists, just resync and return it.
  if (restore?.id && hasWindow(restore.id)) {
    const existing = getWindowById(restore.id);
    scheduleSync(existing);
    return existing;
  }

  // Close picker window if open
  const hostWin = sourceDialog?.closest?.(".win");
  if (hostWin) hostWin.querySelector(".win-close").click();

  // Empty content container (no inner text)
  const content = document.createElement("div");
  content.style.height = "100%";
  content.style.background = "transparent";

  // Use saved geometry if available
  const startX = restore?.x ?? 240;
  const startY = restore?.y ?? 160;
  const startW = restore?.w ?? 720;
  const startH = restore?.h ?? 420;

  // Create the window (respect saved id to avoid duplicates)
  const w = createWindow(
    {
      id: restore?.id || null,
      title: titleOverride || sourceName,
      icon: "🖼️",
      content,
      width: startW,
      height: startH,
      x: startX,
      y: startY,
      kind: "source",
      meta: {
        sourceName,
        interval: restore?.interval ?? 500,
        aspect: null,
        // if we already know which scene item this is (from picker),
        // seed it so we don't have to scan again:
        owningScene: selectedSceneName || restore?.owningScene || null,
        sceneItemId:
          selectedSceneItemId != null
            ? selectedSceneItemId
            : restore?.sceneItemId ?? null,
        last: {}
      }
    },
    taskbarTabs,
    desktop,
    tplWin
  );

  // Honor minimized/maximized states when restoring
  if (restore?.maximized) {
    const b = w.el.querySelector(".win-max");
    if (b) b.click();
  }
  if (restore?.minimized) {
    const b = w.el.querySelector(".win-min");
    if (b) b.click();
  }

  // Maintain aspect on user resize
  const ro = new ResizeObserver(() => {
    if (!w.minimized && w.meta && w.meta.aspect) {
      lockWindowToAspect(w);
    }
  });
  ro.observe(w.el);
  w.meta._ro = ro;

  // Resolve scene & item, compute crop-aware aspect, first sync
  (async () => {
    try {
      let sceneName = w.meta.owningScene;
      let sceneItemId = w.meta.sceneItemId;

      // Only scan for owning scene if we don't already know it
      if (!sceneName || sceneItemId == null) {
        const r = await findOwningSceneAndItemId(obs, sourceName);
        sceneName = r.sceneName;
        sceneItemId = r.sceneItemId;
        w.meta.owningScene = sceneName;
        w.meta.sceneItemId = sceneItemId;
      }

      const tr = await obs.request("GetSceneItemTransform", {
        sceneName,
        sceneItemId
      });
      const s = tr?.sceneItemTransform || {};
      const { effW, effH } = effectiveSourceSizeFromTransform(s);
      const aspect = effW / effH || 16 / 9;
      w.meta.aspect = aspect;

      if (!restore) {
        const { dx, dy } = getChromeInsets(w);
        const outer = w.el.getBoundingClientRect();
        const minH = 240;
        const newH = Math.max(minH, Math.round((outer.width - dx) / aspect));
        w.el.style.height = newH + dy + "px";
      }
      lockWindowToAspect(w);
    } catch (e) {
      w.meta.last.error = e.message;
    } finally {
      addWindowState(w);
      scheduleSync(w);
    }
  })();

  return w;
}
