/* =========================================================
   Windows Desktop + OBS live sources — robust sync + Debug tab
   • Only source windows are AR-locked (content area), others free-resize
   • Alignment is NOT forced → you can change it in OBS
   • Dynamic canvas (VideoSettingsChanged) + scene-aware sync
   • Content rect mapping (CSS px → OBS base canvas)
   • Persistence + Reset button + no scrollbars
   • Always-on AR via lockWindowToAspect() + ResizeObserver
   • NEW: Bi-directional sync (window ⇄ OBS). Last mover wins with echo suppression.
   ========================================================= */

(() => {
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const desktop = $("#desktop");
  const taskbarTabs = $("#taskbar-tabs");
  const startBtn = $("#start-btn");
  const startMenu = $("#start-menu");
  const dateEl = $("#taskbar-date");
  const clockEl = $("#taskbar-clock");
  const tplWin = $("#window-template");

  // Right taskbar UI
  const obsStatusBtn = $("#obs-status-btn");
  const obsDot = $("#obs-dot");

  // OBS Settings (tabbed)
  const obsSettingsPanel = $("#obs-settings");
  const connectForm = $("#obs-connect-form");
  const obsPort = $("#obs-port");
  const obsPass = $("#obs-pass");
  const obsStatus = $("#obs-status");
  const btnDisconnect = $("#obs-disconnect");
  const btnResetSources = $("#obs-reset-sources");

  // Tabs
  const tabBtnSettings = $("#obs-tab-settings");
  const tabBtnDebug = $("#obs-tab-debug");
  const tabPaneSettings = $("#obs-tabpane-settings");
  const tabPaneDebug = $("#obs-tabpane-debug");

  // Debug els
  const dbgStatus = $("#dbg-status");
  const dbgBase = $("#dbg-base");
  const dbgView = $("#dbg-view");
  const dbgScene = $("#dbg-scene");
  const dbgWindowsList = $("#dbg-windows-list");

  // Source Catalog dialog
  const sourceDialog = $("#source-dialog");
  const sourceGrid = $("#source-grid");
  const sourceRefreshBtn = $("#source-refresh");
  const sourceHint = $("#source-hint");
  const startNewSource = $("#start-new-source");
  const sourceCreateBtn = $("#source-create");
  const sourceCancelBtn = $("#source-cancel");
  const sourceCustomTitle = $("#source-custom-title");
  let selectedSourceName = "";
  let selectedCardEl = null;

  /* ----------------------------- Clock & Date ----------------------------- */
  function updateClock() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth()+1).padStart(2, "0");
    const yyyy = now.getFullYear();
    dateEl.textContent = `${dd}/${mm}/${yyyy}`;
    clockEl.textContent = now.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* --------------------------- Persistence layer -------------------------- */
  const STORE_KEY = "win_desktop_state_v1";
  const STORE_OBS  = "obs_settings_v1";

  function readState() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; } }
  function writeState(s) { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
  function readObsSettings() { try { return JSON.parse(localStorage.getItem(STORE_OBS) || "{}"); } catch { return {}; } }
  function writeObsSettings(obj) { localStorage.setItem(STORE_OBS, JSON.stringify(obj)); }

  let state = Object.assign({ windows: [] }, readState());
  function saveStateDebounced() {
    clearTimeout(saveStateDebounced.t);
    saveStateDebounced.t = setTimeout(() => writeState(state), 120);
  }

  function addWindowState(winInfo) {
    if (winInfo.kind !== "source") return;
    const rect = winInfo.el.getBoundingClientRect();
    const contentRect = getWindowContentRect(winInfo);
    const entry = {
      kind: "source",
      id: winInfo.id,
      title: winInfo.title,
      icon: winInfo.icon,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      minimized: !!winInfo.minimized,
      maximized: !!winInfo.maximized,
      sourceName: winInfo.meta?.sourceName || "",
      interval: winInfo.meta?.interval || 500,
      cx: Math.round(contentRect.x),
      cy: Math.round(contentRect.y),
      cw: Math.round(contentRect.w),
      ch: Math.round(contentRect.h),
      aspect: winInfo.meta?.aspect || null
    };
    const i = state.windows.findIndex(w => w.id === entry.id);
    if (i >= 0) state.windows[i] = entry; else state.windows.push(entry);
    saveStateDebounced();
  }
  function removeWindowState(id) {
    state.windows = state.windows.filter(w => w.id !== id);
    saveStateDebounced();
  }
  function updateWindowGeom(winInfo) { addWindowState(winInfo); scheduleSync(winInfo); }

  /* ----------------------------- Start Menu ------------------------------ */
  startBtn.addEventListener("click", () => { startMenu.hidden = !startMenu.hidden; });
  document.addEventListener("click", (e) => {
    if (!startMenu.hidden && !startMenu.contains(e.target) && e.target !== startBtn) startMenu.hidden = true;
  });

  startNewSource.addEventListener("click", () => { startMenu.hidden = true; openSourceDialog(); });

  function openSourceDialog(){
    const container = document.createElement("div");
    container.appendChild(sourceDialog);
    sourceDialog.classList.remove("hidden");
    createWindow({
      title: "Add Source Window",
      icon: "🖼️",
      content: container,
      width: 680, height: 520, x: 160, y: 120,
      kind: "generic"
    });
    selectedSourceName = "";
    if (selectedCardEl) selectedCardEl.classList.remove("selected");
    selectedCardEl = null;
    sourceCustomTitle.value = "";
    sourceCreateBtn.disabled = true;

    renderSourceCatalog().catch(err => sourceHint.textContent = err.message);
  }

  /* -------------- OBS indicator (right of taskbar) ----------------------- */
  obsStatusBtn.addEventListener("click", () => openObsSettingsWindow());
  function setObsIndicator(stateText){
    obsStatusBtn.title = `OBS: ${stateText}`;
    obsDot.title = stateText;
    let color = "var(--red)";
    if (/connect/i.test(stateText) && /ing/.test(stateText)) color = "var(--yellow)";
    else if (/connected/i.test(stateText)) color = "var(--green)";
    obsDot.style.background = color;
  }

  /* ------------------------- Window / Taskbar system ---------------------- */
  let zTop = 10;
  const windows = new Map();
  let winSeq = 1;

  function createWindow({title="Window", icon="🗔", content=null, width=560, height=360, x=140, y=140, id=null, kind="generic", meta=null} = {}) {
    const node = tplWin.content.firstElementChild.cloneNode(true);
    node.style.width = width + "px";
    node.style.height = height + "px";
    node.style.left = x + "px";
    node.style.top = y + "px";

    $(".win-caption", node).textContent = title;
    $(".win-icon", node).textContent = icon;
    if (content) $(".win-content", node).appendChild(content);

    desktop.appendChild(node);
    bringToFront(node);

    const _id = id || ("w" + (winSeq++));
    node.dataset.winId = _id;

    const tab = document.createElement("button");
    tab.className = "taskbar-tab";
    tab.setAttribute("role", "tab");
    tab.dataset.winId = _id;
    tab.innerHTML = `<span class="tab-icon">${icon}</span><span class="tab-title">${title}</span>`;
    taskbarTabs.appendChild(tab);

    const winInfo = { id:_id, el:node, tab, title, icon, minimized:false, maximized:false, prevRect:null, kind, meta: meta || {} };

    // NEW: origin tracking & suppression windows ⇄ OBS
    winInfo.meta.lastOrigin = null; // 'window' | 'obs'
    winInfo.meta.lastStamp  = 0;
    winInfo.meta.suppressWindowToObsUntil = 0; // if OBS moved last, suppress pushing back
    winInfo.meta.suppressObsToWindowUntil = 0; // if Window moved last, suppress echo from OBS

    windows.set(_id, winInfo);

    tab.addEventListener("click", () => {
      if (winInfo.minimized) setMinimized(winInfo, false);
      else setMinimized(winInfo, true);
    });

    setupWindowControls(winInfo);
    setupDragResize(winInfo);
    focusWindow(winInfo);

    return winInfo;
  }

  function focusWindow(winInfo) {
    for (const w of windows.values()) w.tab.classList.toggle("active", w.id === winInfo.id);
    bringToFront(winInfo.el);
  }
  function bringToFront(el) { zTop += 1; el.style.zIndex = String(zTop); }

  function setMinimized(winInfo, value) {
    winInfo.minimized = !!value;
    winInfo.el.style.display = winInfo.minimized ? "none" : "grid";
    if (!winInfo.minimized) focusWindow(winInfo);
    addWindowState(winInfo);
    if (!winInfo.minimized) scheduleSync(winInfo);
  }
  function toggleMinimize(winInfo) { setMinimized(winInfo, !winInfo.minimized); }

  function closeWindow(winInfo) {
    // cleanup ResizeObserver if present
    if (winInfo.meta?._ro) { try { winInfo.meta._ro.disconnect(); } catch{} }
    windows.delete(winInfo.id);
    winInfo.el.remove();
    winInfo.tab.remove();
    removeWindowState(winInfo.id);
    renderDebug();
  }

  function setupWindowControls(winInfo) {
    const el = winInfo.el;
    $(".win-min", el).addEventListener("click", () => toggleMinimize(winInfo));
    $(".win-close", el).addEventListener("click", () => closeWindow(winInfo));
    $(".win-max", el).addEventListener("click", () => {
      toggleMaximize(winInfo);
      // mark window-origin
      winInfo.meta.lastOrigin = 'window';
      winInfo.meta.lastStamp  = performance.now();
    });
    el.addEventListener("mousedown", () => focusWindow(winInfo));
  }

  function toggleMaximize(winInfo) {
    if (winInfo.minimized) setMinimized(winInfo, false);
    const el = winInfo.el;
    if (!winInfo.maximized) {
      winInfo.prevRect = el.getBoundingClientRect();
      const desktopRect = desktop.getBoundingClientRect();

      const isSource = winInfo.kind === "source";
      const aspect = isSource ? getAspect(winInfo) : null;

      const margin = 8;
      const availW = Math.round(desktopRect.width  - margin*2);
      const availH = Math.round(desktopRect.height - margin*2 - 46);

      if (isSource && aspect && isFinite(aspect) && aspect > 0) {
        const { dx: chromeX, dy: chromeY } = getChromeInsets(winInfo);
        let contentW = availW - chromeX;
        let contentH = Math.round(contentW / aspect);
        if (contentH > (availH - chromeY)) {
          contentH = (availH - chromeY);
          contentW = Math.round(contentH * aspect);
        }
        el.style.left = (desktopRect.left + margin) + "px";
        el.style.top  = (desktopRect.top  + margin) + "px";
        el.style.width  = (contentW + chromeX) + "px";
        el.style.height = (contentH + chromeY) + "px";
      } else {
        el.style.left = (desktopRect.left + margin) + "px";
        el.style.top  = (desktopRect.top  + margin) + "px";
        el.style.width  = availW + "px";
        el.style.height = availH + "px";
      }
      winInfo.maximized = true;
    } else {
      const r = winInfo.prevRect;
      el.style.left = r.left + "px"; el.style.top = r.top + "px";
      el.style.width = r.width + "px"; el.style.height = r.height + "px";
      winInfo.maximized = false;
    }

    // normalize AR after any maximize/restore
    if (winInfo.kind === "source") lockWindowToAspect(winInfo);

    addWindowState(winInfo);
    scheduleSync(winInfo);
  }

  /* ------------------------ Aspect-locked drag/resize --------------------- */
  function setupDragResize(winInfo) {
    const el = winInfo.el;
    const titlebar = $(".win-titlebar", el);
    let dragging = false, offsetX = 0, offsetY = 0;

    titlebar.addEventListener("mousedown", (e) => {
      if (e.target.closest(".win-controls")) return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    function onMove(e){
      if (!dragging) return;
      const x = Math.min(window.innerWidth - 100, Math.max(0, e.clientX - offsetX));
      const maxH = window.innerHeight - 46;
      const y = Math.min(maxH - 60, Math.max(0, e.clientY - offsetY));
      el.style.left = x + "px"; el.style.top = y + "px";

      // mark window-origin
      winInfo.meta.lastOrigin = 'window';
      winInfo.meta.lastStamp  = performance.now();

      scheduleSync(winInfo);
    }
    function onUp(){
      dragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      updateWindowGeom(winInfo);
    }

    const resizer = $(".win-resizer", el);
    let resizing = false, startW=0, startH=0, startX=0, startY=0;
    resizer.addEventListener("mousedown", (e) => {
      resizing = true;
      const rect = el.getBoundingClientRect();
      startW = rect.width; startH = rect.height; startX = e.clientX; startY = e.clientY;
      document.addEventListener("mousemove", onResize);
      document.addEventListener("mouseup", onResizeUp);
      e.preventDefault();
    });

    function onResize(e){
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const isSource = winInfo.kind === "source";
      const aspect = isSource ? getAspect(winInfo) : null;

      const { dx: chromeX, dy: chromeY } = getChromeInsets(winInfo);
      const minContentW = 320;
      const minContentH = 240;

      if (isSource && aspect && isFinite(aspect) && aspect > 0) {
        const startOuter = winInfo.el.getBoundingClientRect();
        const startContentW = Math.max(1, Math.round(startOuter.width  - chromeX));
        const startContentH = Math.max(1, Math.round(startOuter.height - chromeY));

        let newContentW = startContentW + dx;
        let newContentH = startContentH + dy;

        if (Math.abs(dx) >= Math.abs(dy)) {
          newContentW = Math.max(minContentW, newContentW);
          newContentH = Math.round(newContentW / aspect);
        } else {
          newContentH = Math.max(minContentH, newContentH);
          newContentW = Math.round(newContentH * aspect);
        }

        winInfo.el.style.width  = (newContentW + chromeX) + "px";
        winInfo.el.style.height = (newContentH + chromeY) + "px";
      } else {
        // Non-source windows: free resize
        winInfo.el.style.width  = Math.max(240, startW + dx) + "px";
        winInfo.el.style.height = Math.max(160, startH + dy) + "px";
      }

      // mark window-origin
      winInfo.meta.lastOrigin = 'window';
      winInfo.meta.lastStamp  = performance.now();

      scheduleSync(winInfo);
    }
    function onResizeUp(){
      resizing = false;
      document.removeEventListener("mousemove", onResize);
      document.removeEventListener("mouseup", onResizeUp);
      // normalize AR after manual resize ends
      if (winInfo.kind === "source") lockWindowToAspect(winInfo);
      updateWindowGeom(winInfo);
    }
  }

  /* ----------------------- OBS WebSocket Client (v5) ---------------------- */
  const OBS_OP = { Hello: 0, Identify: 1, Identified: 2, Reidentify: 3, Event: 5, Request: 6, RequestResponse: 7 };

  class OBSClient {
    constructor() {
      this.ws=null; this.connected=false; this.reqIdSeq=1; this.pending=new Map();
      this.hello=null; this.password=""; this.baseW=0; this.baseH=0;
      this.onEvent = () => {};
    }
    async connect(host="127.0.0.1", port=4455, password="") {
      await this.disconnect();
      return new Promise((resolve, reject) => {
        try { this.ws = new WebSocket(`ws://${host}:${port}`); } catch (err) { return reject(err); }
        this.password = password;

        this.ws.addEventListener("error", () => reject(new Error("WebSocket error")));
        this.ws.addEventListener("close", () => {
          this.connected = false;
          this.pending.forEach(p => p.reject(new Error("OBS disconnected")));
          this.pending.clear();
          updateObsStatus("Disconnected");
          renderDebug();
        });
        this.ws.addEventListener("message", async (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.op === OBS_OP.Hello) {
            this.hello = msg.d;
            try {
              const ident = await this._buildIdentify(this.hello, this.password);
              this.ws.send(JSON.stringify({ op: OBS_OP.Identify, d: ident }));
            } catch (e) { reject(e); }
          } else if (msg.op === OBS_OP.Identified) {
            this.connected = true;
            updateObsStatus("Connected");
            writeObsSettings({ host:"127.0.0.1", port:Number(obsPort.value)||4455, password:obsPass.value||"" });
            try { await this.refreshVideoSettings(); } catch {}
            resolve();
            renderDebug();
          } else if (msg.op === OBS_OP.Event) {
            this.onEvent(msg.d);
            if (msg?.d?.eventType === "VideoSettingsChanged") {
              this.refreshVideoSettings().then(renderDebug).catch(()=>{});
            } else {
              renderDebug();
            }
          } else if (msg.op === OBS_OP.RequestResponse) {
            const { requestId, requestStatus } = msg.d;
            const pend = this.pending.get(requestId);
            if (pend) {
              this.pending.delete(requestId);
              if (requestStatus?.result) pend.resolve(msg.d.responseData || {});
              else pend.reject(new Error(requestStatus?.comment || "OBS request failed"));
            }
          }
        });
      });
    }
    async refreshVideoSettings(){
      const v = await this.request("GetVideoSettings", {});
      this.baseW = Number(v?.baseWidth || 0);
      this.baseH = Number(v?.baseHeight || 0);
    }
    async disconnect() { if (this.ws) { try{this.ws.close();}catch{} this.ws=null; } this.connected=false; }
    async request(type, data={}) {
      if (!this.ws || !this.connected) throw new Error("Not connected");
      const reqId = String(this.reqIdSeq++);
      const payload = { op: OBS_OP.Request, d: { requestType: type, requestId: reqId, requestData: data } };
      const p = new Promise((resolve, reject) => this.pending.set(reqId, {resolve, reject}));
      this.ws.send(JSON.stringify(payload));
      return p;
    }
    async getInputs() {
      try { const data = await this.request("GetInputList", {}); return Array.isArray(data?.inputs) ? data.inputs : []; }
      catch { return []; }
    }
    async _buildIdentify(hello, password) {
      const ident = { rpcVersion: hello.rpcVersion, eventSubscriptions: 0xFFFFFFFF };
      if (hello.authentication) {
        const { challenge, salt } = hello.authentication;
        ident.authentication = await computeAuth(password, salt, challenge);
      }
      return ident;
    }
  }

  async function computeAuth(password, saltB64, challengeB64) {
    const saltBytes = base64ToBytes(saltB64);
    const challengeBytes = base64ToBytes(challengeB64);
    const secret = await sha256Bytes(concatBytes(utf8Bytes(password), saltBytes));
    const secretB64 = bytesToBase64(secret);
    const final = await sha256Bytes(concatBytes(utf8Bytes(secretB64), challengeBytes));
    return bytesToBase64(final);
  }
  function utf8Bytes(str){ return new TextEncoder().encode(str); }
  function concatBytes(a, b){ const c = new Uint8Array(a.length + b.length); c.set(a,0); c.set(b,a.length); return c; }
  async function sha256Bytes(bytes){ const buf = await crypto.subtle.digest("SHA-256", bytes); return new Uint8Array(buf); }
  function bytesToBase64(bytes){ let s=""; bytes.forEach(b => s+=String.fromCharCode(b)); return btoa(s); }
  function base64ToBytes(b64){ const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }

  const obs = new OBSClient();

  /* -------------------- Helpers for bi-directional sync ------------------- */
  // Content rect in CSS px
  function getWindowContentRect(winInfo){
    const cont = winInfo.el.querySelector(".win-content");
    const r = cont.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  function getAspect(winInfo){
    const a = winInfo?.meta?.aspect;
    if (a && isFinite(a) && a > 0) return a;
    return null;
  }
  function getChromeInsets(winInfo){
    const el = winInfo.el;
    const content = el.querySelector(".win-content");
    const er = el.getBoundingClientRect();
    const cr = content.getBoundingClientRect();
    const dx = Math.round(er.width  - cr.width);
    const dy = Math.round(er.height - cr.height);
    return { dx, dy };
  }
  // Detailed insets (for positioning)
  function getContentInsets(winInfo){
    const el = winInfo.el;
    const content = el.querySelector(".win-content");
    const er = el.getBoundingClientRect();
    const cr = content.getBoundingClientRect();
    return {
      left:  Math.round(cr.left - er.left),
      top:   Math.round(cr.top  - er.top),
      right: Math.round(er.right - cr.right),
      bottom:Math.round(er.bottom - cr.bottom),
      dx:    Math.round(er.width  - cr.width),
      dy:    Math.round(er.height - cr.height),
    };
  }

  // OBS alignment bitmask:
  // H: LEFT=1, CENTER=2, RIGHT=4
  // V: TOP=8,  CENTER=16, BOTTOM=32
  function decodeAlignment(axBits){
    const hmask = axBits & (1|2|4);
    const vmask = axBits & (8|16|32);
    // Horizontal
    let ax;
    if (hmask === 4) ax = 1;            // RIGHT
    else if (hmask === 2) ax = 0.5;     // CENTER
    else if (hmask === 1) ax = 0;       // LEFT
    else ax = 0.5;                      // multiple/unknown → CENTER
    // Vertical
    let ay;
    if (vmask === 32) ay = 1;           // BOTTOM
    else if (vmask === 16) ay = 0.5;    // CENTER
    else if (vmask === 8)  ay = 0;      // TOP
    else ay = 0.5;                      // multiple/unknown → CENTER
    return { ax, ay };
  }

  // Compute anchor offsets, respecting bounds:
  // - If bounds are NONE → position is already top-left → (ox,oy)=(0,0)
  // - Else anchor is inside the bounds rect → use boundsWidth/Height
  function anchorOffsetsForTransform(tr, drawW, drawH){
    const boundsType = tr?.boundsType || "OBS_BOUNDS_NONE";
    const align = Number(tr?.alignment) || 0;

    if (boundsType === "OBS_BOUNDS_NONE") {
      return { ox: 0, oy: 0, ax: 0, ay: 0, used: "none" };
    }

    const { ax, ay } = decodeAlignment(align);
    const bw = Math.max(1, Math.round(Number(tr?.boundsWidth  || drawW)));
    const bh = Math.max(1, Math.round(Number(tr?.boundsHeight || drawH)));
    return { ox: bw * ax, oy: bh * ay, ax, ay, used: "bounds" };
  }


  // Force outer window so *content* matches aspect
  function lockWindowToAspect(winInfo){
    if (winInfo.kind !== "source") return;
    const aspect = getAspect(winInfo);
    if (!aspect || !isFinite(aspect) || aspect <= 0) return;
    const { dx: chromeX, dy: chromeY } = getChromeInsets(winInfo);
    const outer = winInfo.el.getBoundingClientRect();
    let contentW = Math.max(1, Math.round(outer.width  - chromeX));
    let contentH = Math.max(1, Math.round(outer.height - chromeY));
    const targetHfromW = Math.round(contentW / aspect);
    const targetWfromH = Math.round(contentH * aspect);
    const diffH = Math.abs(targetHfromW - contentH);
    const diffW = Math.abs(targetWfromH - contentW);
    if (diffH < diffW) contentH = targetHfromW; else contentW = targetWfromH;
    winInfo.el.style.width  = (contentW + chromeX) + "px";
    winInfo.el.style.height = (contentH + chromeY) + "px";
  }

  /* ---------------- OBS event → Bi-directional handling ------------------- */
  obs.onEvent = (ev) => {
    const t = ev?.eventType || "";
    if (t === "SceneItemTransformChanged") {
      const d = ev?.eventData || {};
      const sceneName = d?.sceneName;
      const sceneItemId = d?.sceneItemId;
      if (sceneName == null || sceneItemId == null) return;

      // find our window mapped to this scene item
      for (const w of windows.values()) {
        if (w.kind !== 'source') continue;
        if (w.meta?.owningScene === sceneName && w.meta?.sceneItemId === sceneItemId) {
          const now = performance.now();
          // if we just pushed from window, skip echo
          if (now < (w.meta.suppressObsToWindowUntil || 0)) return;
          applyObsTransformToWindow(w).catch(err => {
            w.meta.last = w.meta.last || {};
            w.meta.last.error = err.message;
            renderDebug();
          });
          break;
        }
      }
      return; // handled
    }

    // Other events: just resync
    if (
      t === "CurrentProgramSceneChanged" ||
      t === "CurrentPreviewSceneChanged" ||
      t === "SceneItemCreated" ||
      t === "SceneItemRemoved" ||
      t === "VideoSettingsChanged"
    ){
      for (const w of windows.values()) scheduleSync(w);
    }
  };

  function updateObsStatus(text){
    obsStatus.textContent = text;
    setObsIndicator(text);
    renderDebug();
  }

  /* ---------------------------- OBS UI wiring ----------------------------- */
  function openObsSettingsWindow() {
    const content = document.createElement("div");
    content.appendChild(obsSettingsPanel);
    obsSettingsPanel.classList.remove("hidden");
    createWindow({ title: "OBS Settings", icon: "⚙️", content, width: 640, height: 380, x: 120, y: 100, kind: "generic" });
    const saved = readObsSettings();
    if (saved?.port) obsPort.value = String(saved.port);
    if (typeof saved?.password === "string") obsPass.value = saved.password;
    renderDebug(); // populate on open
  }

  // Tabs behavior
  function setTab(which){
    const settingsActive = (which === "settings");
    tabBtnSettings.classList.toggle("active", settingsActive);
    tabBtnDebug.classList.toggle("active", !settingsActive);
    tabPaneSettings.classList.toggle("active", settingsActive);
    tabPaneDebug.classList.toggle("active", !settingsActive);
  }
  tabBtnSettings?.addEventListener("click", () => setTab("settings"));
  tabBtnDebug?.addEventListener("click", () => { setTab("debug"); renderDebug(); });

  connectForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      updateObsStatus("Connecting…");
      await obs.connect("127.0.0.1", Number(obsPort.value) || 4455, obsPass.value || "");
    } catch (err) {
      updateObsStatus("Disconnected");
      obsStatus.textContent = "Connection failed: " + err.message;
      setObsIndicator("Disconnected");
    }
  });

  btnDisconnect?.addEventListener("click", async () => {
    await obs.disconnect();
    updateObsStatus("Disconnected");
  });

  btnResetSources?.addEventListener("click", () => {
    const toClose = Array.from(windows.values()).filter(w => w.kind === "source");
    let count = 0;
    for (const w of toClose) {
      const closeBtn = w.el.querySelector(".win-close");
      if (closeBtn) closeBtn.click(); else closeWindow(w);
      count++;
    }
    state.windows = [];
    writeState(state);
    obsStatus.textContent = `Removed ${count} source window${count === 1 ? "" : "s"}.`;
    renderDebug();
  });

  /* -------------------- Scene-only source catalog ------------------------- */
  let cachedInputs = []; // kind lookup
  sourceRefreshBtn?.addEventListener("click", () => renderSourceCatalog().catch(e => sourceHint.textContent = e.message));

  async function renderSourceCatalog(){
    sourceGrid.innerHTML = "";
    if (!obs.connected) { sourceHint.textContent = "Connect to OBS to list scene sources."; return; }
    if (!cachedInputs.length) cachedInputs = await obs.getInputs();
    const kindByName = new Map(cachedInputs.map(i => [i.inputName, (i.inputKind||"").toLowerCase()]));

    const sceneName = await getActiveSceneName();
    const items = await obs.request("GetSceneItemList", { sceneName });
    const sceneItems = Array.isArray(items?.sceneItems) ? items.sceneItems : [];

    const filtered = sceneItems
      .map(it => ({ name: it?.sourceName || "", id: it?.sceneItemId }))
      .filter(it => it.name && kindByName.has(it.name) && kindByName.get(it.name) !== "browser_source");

    if (!filtered.length) { sourceHint.textContent = `No non-Browser sources in scene "${sceneName}".`; return; }
    sourceHint.textContent = `${filtered.length} source${filtered.length===1?"":"s"} in scene "${sceneName}".`;

    for (const it of filtered) {
      const kind = kindByName.get(it.name);
      const card = document.createElement("div");
      card.className = "source-card";
      card.innerHTML = `
        <div class="sc-icon">${iconForKind(kind)}</div>
        <div class="sc-title" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
        <div class="sc-kind">${prettyKind(kind)}</div>
      `;
      card.addEventListener("click", () => {
        if (selectedCardEl) selectedCardEl.classList.remove("selected");
        selectedCardEl = card;
        selectedCardEl.classList.add("selected");
        selectedSourceName = it.name;
        if (!sourceCustomTitle.value.trim()) sourceCustomTitle.value = it.name;
        sourceCreateBtn.disabled = false;
      });
      sourceGrid.appendChild(card);
    }
  }

  function prettyKind(kind){
    if (kind.includes("monitor") || kind.includes("display") || kind.includes("screen")) return "Display Capture";
    if (kind.includes("window")) return "Window Capture";
    if (kind.includes("dshow") || kind.includes("v4l")) return "Video Device";
    if (kind.includes("decklink")) return "DeckLink";
    if (kind.includes("ndi")) return "NDI Source";
    if (kind.includes("av_capture")) return "AV Capture";
    if (kind.includes("game")) return "Game Capture";
    return kind || "Source";
  }
  function iconForKind(kind){
    if (kind.includes("monitor") || kind.includes("display") || kind.includes("screen")) return "🖥️";
    if (kind.includes("window")) return "🪟";
    if (kind.includes("dshow") || kind.includes("v4l")) return "📷";
    if (kind.includes("decklink")) return "🎞️";
    if (kind.includes("ndi")) return "🌐";
    if (kind.includes("av_capture")) return "🎥";
    if (kind.includes("game")) return "🎮";
    return "🎛️";
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  sourceCreateBtn?.addEventListener("click", async () => {
    if (!selectedSourceName) return;
    const titleOverride = sourceCustomTitle.value.trim() || selectedSourceName;
    createSourceWindow(selectedSourceName, 500, null, titleOverride);
  });
  sourceCancelBtn?.addEventListener("click", () => {
    const hostWin = sourceDialog.closest(".win");
    if (hostWin) hostWin.querySelector(".win-close").click();
  });

  /* -------------------- Create + sync a Source Window --------------------- */
  function createSourceWindow(sourceName, ms, restoreParams = null, titleOverride = null) {
    // close dialog window if open
    const hostWin = sourceDialog.closest(".win");
    if (hostWin) hostWin.querySelector(".win-close").click();

    const content = document.createElement("div");
    content.style.height = "100%";
    content.style.background = "transparent";

    const info = document.createElement("div");
    info.style.fontSize = "12px";
    info.style.marginTop = "6px";
    info.style.opacity = "0.75";
    info.textContent = `Source: ${sourceName} (live)`;
    content.appendChild(info);

    const windowTitle = titleOverride || sourceName;
    const w = createWindow({
      title: windowTitle, icon: "🖼️", content,
      width: restoreParams?.w ?? 720,
      height: restoreParams?.h ?? 420,
      x: restoreParams?.x ?? 240,
      y: restoreParams?.y ?? 160,
      id: restoreParams?.id ?? null,
      kind: "source",
      meta: { sourceName, interval: ms, aspect: null, owningScene: null, sceneItemId: null, last: {} }
    });

    if (restoreParams?.maximized) toggleMaximize(w);
    if (restoreParams?.minimized) setMinimized(w, true);

    // AR safety — observe size nudges and keep content-area AR true
    const ro = new ResizeObserver(() => {
      if (w.meta && w.meta.aspect) lockWindowToAspect(w);
    });
    ro.observe(w.el);
    w.meta._ro = ro;

    // Resolve owning scene + native size → set AR & first sync
    (async () => {
      try {
        const { sceneName, sceneItemId } = await findOwningSceneAndItemId(sourceName);
        w.meta.owningScene = sceneName;
        w.meta.sceneItemId = sceneItemId;

        const nat = await getSourceNativeSize(sceneName, sceneItemId, sourceName);
        const aspect = nat.w / nat.h || (16/9);
        w.meta.aspect = aspect;

        // Adjust height so that *content* matches aspect (chrome insets considered)
        const { dx: chromeX, dy: chromeY } = getChromeInsets(w);
        const outer = w.el.getBoundingClientRect();
        const minContentH = 240;
        const newContentH = Math.max(minContentH, Math.round((outer.width - chromeX) / aspect));
        w.el.style.height = (newContentH + chromeY) + "px";

        // snap to exact AR once native size known
        lockWindowToAspect(w);
      } catch (e) {
        w.meta.last.error = e.message;
      } finally {
        addWindowState(w);
        scheduleSync(w);
        renderDebug();
      }
    })();

    const persist = () => { addWindowState(w); renderDebug(); };
    $(".win-close", w.el).addEventListener("click", () => {});
    $(".win-min", w.el).addEventListener("click", persist);
    $(".win-max", w.el).addEventListener("click", persist);
    w.el.addEventListener("mouseup", persist);
    addWindowState(w);
    renderDebug();
  }

  /* -------------------- OBS item sync (live, AR-preserving) --------------- */
  const sourceNativeSize = new Map();  // `${scene}::${source}` -> {w,h}
  const owningSceneCache = new Map();  // sourceName -> { sceneName, sceneItemId }
  const pendingSyncs = new Set();      // window ids queued for rAF sync

  function scheduleSync(winInfo){
    if (!winInfo) return;
    const now = performance.now();
    // If OBS just drove a change, suppress pushing back briefly
    if (now < (winInfo.meta.suppressWindowToObsUntil || 0)) return;

    if (pendingSyncs.has(winInfo.id)) return;
    pendingSyncs.add(winInfo.id);
    requestAnimationFrame(() => {
      pendingSyncs.delete(winInfo.id);
      syncObsItemToWindow(winInfo).catch(err => {
        winInfo.meta.last = winInfo.meta.last || {};
        winInfo.meta.last.error = err.message;
        renderDebug();
      });
    });
  }

  async function syncObsItemToWindow(winInfo){
    if (winInfo.kind !== "source") return;
    if (!obs.connected) return;

    // Don't push if this change came from OBS very recently (echo)
    const now = performance.now();
    if (now < (winInfo.meta.suppressWindowToObsUntil || 0)) return;

    if (!obs.baseW || !obs.baseH) {
      await obs.refreshVideoSettings().catch(()=>{});
    }

    if (!winInfo.meta.owningScene || !winInfo.meta.sceneItemId) {
      const r = await findOwningSceneAndItemId(winInfo.meta.sourceName);
      winInfo.meta.owningScene = r.sceneName;
      winInfo.meta.sceneItemId = r.sceneItemId;
    }

    const { x, y, w, h } = getWindowContentRect(winInfo);
    if (w <= 0 || h <= 0) return;

    // Map CSS px → OBS base canvas px using current viewport size
    const cssW = document.documentElement.clientWidth;
    const cssH = document.documentElement.clientHeight;
    const baseW = obs.baseW || cssW;
    const baseH = obs.baseH || cssH;

    const sx = baseW / cssW;
    const sy = baseH / cssH;

    const mapped = {
      x: Math.round(x * sx),
      y: Math.round(y * sy),
      w: Math.max(1, Math.round(w * sx)),
      h: Math.max(1, Math.round(h * sy))
    };

    const sceneName = winInfo.meta.owningScene;
    const sceneItemId = winInfo.meta.sceneItemId;

    const nat = await getSourceNativeSize(sceneName, sceneItemId, winInfo.meta.sourceName);
    const srcW = nat.w, srcH = nat.h;

    const scale = Math.max(0.0001, Math.min(mapped.w / srcW, mapped.h / srcH));

    // Position: top-left of content rect (we do not force alignment)
    const posX = Math.round(mapped.x);
    const posY = Math.round(mapped.y);

    const transform = {
      positionX: posX,
      positionY: posY,
      rotation: 0,
      scaleX: scale,
      scaleY: scale,
      boundsType: "OBS_BOUNDS_NONE" // do not include boundsWidth/Height when NONE
    };

    // mark: window drove this update; ignore OBS echo shortly
    const pushHushMs = 250;
    winInfo.meta.lastOrigin = 'window';
    winInfo.meta.lastStamp  = performance.now();
    winInfo.meta.suppressObsToWindowUntil = winInfo.meta.lastStamp + pushHushMs;

    await obs.request("SetSceneItemTransform", {
      sceneName,
      sceneItemId,
      sceneItemTransform: transform
    });

    // Debug
    winInfo.meta.last = {
      mappedX: mapped.x, mappedY: mapped.y, mappedW: mapped.w, mappedH: mapped.h,
      scale, srcW, srcH, posX, posY, error: ""
    };
    renderDebug();
  }

  async function applyObsTransformToWindow(winInfo){
    if (!obs.connected) return;

    const tr = await obs.request("GetSceneItemTransform", {
      sceneName: winInfo.meta.owningScene,
      sceneItemId: winInfo.meta.sceneItemId
    });
    const s = tr?.sceneItemTransform || {};

    const srcW   = Math.max(1, Math.round(Number(s.sourceWidth  || 1)));
    const srcH   = Math.max(1, Math.round(Number(s.sourceHeight || 1)));
    const scaleX = Number(s.scaleX || 1);
    const scaleY = Number(s.scaleY || 1);
    const drawW  = Math.max(1, Math.round(srcW * scaleX));
    const drawH  = Math.max(1, Math.round(srcH * scaleY));

    // NEW: use bounds-aware anchor (0,0 if NONE)
    const { ox, oy, ax, ay, used } = anchorOffsetsForTransform(s, drawW, drawH);

    // OBS base px -> CSS px
    const cssW = document.documentElement.clientWidth;
    const cssH = document.documentElement.clientHeight;
    const baseW = obs.baseW || cssW;
    const baseH = obs.baseH || cssH;
    const invSX = cssW / baseW;
    const invSY = cssH / baseH;

    // Content top-left (CSS px): if bounds NONE, this is just positionX/Y
    const contentLeft = (Number(s.positionX || 0) - ox) * invSX;
    const contentTop  = (Number(s.positionY || 0) - oy) * invSY;
    const contentW    = drawW * invSX;
    const contentH    = drawH * invSY;

    // Place OUTER window so its content aligns
    const insets = getContentInsets(winInfo);
    winInfo.el.style.left   = (Math.round(contentLeft) - insets.left) + "px";
    winInfo.el.style.top    = (Math.round(contentTop ) - insets.top ) + "px";
    winInfo.el.style.width  = (Math.round(contentW) + insets.dx) + "px";
    winInfo.el.style.height = (Math.round(contentH) + insets.dy) + "px";

    // Echo suppression: OBS drove this change
    const hushMs = 250;
    winInfo.meta.lastOrigin = 'obs';
    winInfo.meta.lastStamp  = performance.now();
    winInfo.meta.suppressWindowToObsUntil = winInfo.meta.lastStamp + hushMs;

    // Persist + debug
    addWindowState(winInfo);
    winInfo.meta.last = Object.assign(winInfo.meta.last || {}, {
      srcW, srcH,
      scale: Math.min(scaleX, scaleY),
      posX: s.positionX, posY: s.positionY,
      align: Number(s.alignment) || 0,
      anchorMode: used,      // "none" or "bounds"
      axAy: `${ax.toFixed(2)},${ay.toFixed(2)}`,
      mappedX: Math.round(contentLeft * (baseW/cssW)),
      mappedY: Math.round(contentTop  * (baseH/cssH)),
      mappedW: Math.round(contentW    * (baseW/cssW)),
      mappedH: Math.round(contentH    * (baseH/cssH)),
      error: ""
    });
    renderDebug();
  }

  async function getSourceNativeSize(sceneName, sceneItemId, sourceName){
    const key = `${sceneName}::${sourceName}`;
    const cached = sourceNativeSize.get(key);
    if (cached && cached.w && cached.h) return cached;

    const t = await obs.request("GetSceneItemTransform", { sceneName, sceneItemId });
    const srcW = Math.max(1, Math.round(t?.sceneItemTransform?.sourceWidth || 0));
    const srcH = Math.max(1, Math.round(t?.sceneItemTransform?.sourceHeight || 0));
    const val = { w: srcW, h: srcH };
    sourceNativeSize.set(key, val);
    return val;
  }

  // Find the scene where this source is a direct child; search all scenes (and groups if available)
  async function findOwningSceneAndItemId(sourceName){
    const cached = owningSceneCache.get(sourceName);
    if (cached?.sceneName && cached?.sceneItemId) return cached;

    const scenes = await obs.request("GetSceneList", {});
    const list = Array.isArray(scenes?.scenes) ? scenes.scenes : [];
    for (const sc of list) {
      const sceneName = sc?.sceneName || sc?.name;
      if (!sceneName) continue;
      const items = await obs.request("GetSceneItemList", { sceneName });
      const arr = Array.isArray(items?.sceneItems) ? items.sceneItems : [];
      const hit = arr.find(it => it?.sourceName === sourceName);
      if (hit?.sceneItemId != null) {
        const res = { sceneName, sceneItemId: hit.sceneItemId };
        owningSceneCache.set(sourceName, res);
        return res;
      }
    }

    try {
      const groups = await obs.request("GetGroupList", {});
      const gnames = Array.isArray(groups?.groups) ? groups.groups : [];
      for (const g of gnames) {
        const gitems = await obs.request("GetGroupSceneItemList", { sceneName: g });
        const arr = Array.isArray(gitems?.sceneItems) ? gitems.sceneItems : [];
        const hit = arr.find(it => it?.sourceName === sourceName);
        if (hit?.sceneItemId != null) {
          const res = { sceneName: g, sceneItemId: hit.sceneItemId };
          owningSceneCache.set(sourceName, res);
          return res;
        }
      }
    } catch {}

    throw new Error(`Source "${sourceName}" not found in any scene/group (check nested Scene Sources).`);
  }

  /* ----------------------------- Global hooks ----------------------------- */
  window.addEventListener("resize", () => {
    for (const w of windows.values()) scheduleSync(w);
    renderDebug();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Meta") startMenu.hidden = !startMenu.hidden;
    if (e.key === "Escape" && !startMenu.hidden) startMenu.hidden = true;
  });

  setObsIndicator("Disconnected");

  /* -------------------------- Restore saved state ------------------------- */
  function restoreAll() {
    const savedObs = readObsSettings();
    if (savedObs?.port) obsPort.value = String(savedObs.port);
    if (typeof savedObs?.password === "string") obsPass.value = savedObs.password;

    if (savedObs?.port != null) {
      (async () => {
        try {
          updateObsStatus("Connecting…");
          await obs.connect(savedObs.host || "127.0.0.1", Number(savedObs.port) || 4455, savedObs.password || "");
        } catch {
          updateObsStatus("Disconnected");
        }
      })();
    }

    const wins = Array.isArray(state.windows) ? state.windows : [];
    for (const w of wins) {
      if (w.kind !== "source") continue;
      const titleOverride = w.title || w.sourceName || "Source";
      createSourceWindow(
        w.sourceName || w.title || "Source",
        Math.max(100, Number(w.interval) || 500),
        { id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minimized: w.minimized, maximized: w.maximized },
        titleOverride
      );
    }
  }

  restoreAll();

  /* ---------------------------- Debug renderer ---------------------------- */
  async function getActiveSceneName(){
    try {
      const prog = await obs.request("GetCurrentProgramScene", {});
      const progName = prog?.currentProgramSceneName || prog?.sceneName;
      if (progName) return progName;
    } catch {}
    try {
      const studio = await obs.request("GetStudioModeEnabled", {});
      if (studio?.studioModeEnabled) {
        const prev = await obs.request("GetCurrentPreviewScene", {});
        const prevName = prev?.currentPreviewSceneName || prev?.sceneName;
        if (prevName) return prevName;
      }
    } catch {}
    const list = await obs.request("GetSceneList", {});
    const scenes = Array.isArray(list?.scenes) ? list.scenes : [];
    if (scenes[0]?.sceneName) return scenes[0].sceneName;
    throw new Error("No active scene found");
  }

  function renderDebugCard(w){
    const last = w.meta.last || {};
    const alignDbg = (last.align != null) ? String(last.align) : "—";
    const ownScene = w.meta.owningScene || "—";
    const sid = (w.meta.sceneItemId != null) ? String(w.meta.sceneItemId) : "—";
    const aspect = w.meta.aspect ? w.meta.aspect.toFixed(4) : "—";
    const errLine = last.error ? `<div class="dbg-row dbg-err">${escapeHtml(last.error)}</div>` : "";
    return `
      <div class="dbg-card">
        <div class="dbg-row"><span class="k">Align:</span><span class="v">${alignDbg}</span></div>
        <div class="dbg-row"><span class="k">Title:</span><span class="v">${escapeHtml(w.title)}</span></div>
        <div class="dbg-row"><span class="k">Source:</span><span class="v">${escapeHtml(w.meta.sourceName)}</span></div>
        <div class="dbg-row"><span class="k">Owning Scene:</span><span class="v">${escapeHtml(ownScene)}</span><span class="k">ItemId:</span><span class="v">${sid}</span></div>
        <div class="dbg-row"><span class="k">Aspect:</span><span class="v">${aspect}</span></div>
        <div class="dbg-row"><span class="k">Mapped:</span><span class="v">${last.mappedX ?? "—"},${last.mappedY ?? "—"} ${last.mappedW ?? "—"}×${last.mappedH ?? "—"}</span></div>
        <div class="dbg-row"><span class="k">Src:</span><span class="v">${last.srcW ?? "—"}×${last.srcH ?? "—"}</span><span class="k">Scale:</span><span class="v">${last.scale ? last.scale.toFixed(4) : "—"}</span></div>
        <div class="dbg-row"><span class="k">Pos:</span><span class="v">${last.posX ?? "—"},${last.posY ?? "—"}</span></div>
        <div class="dbg-row"><span class="k">Align:</span><span class="v">${alignDbg}</span></div>
        ${last.error ? `<div class="dbg-row dbg-err">${escapeHtml(last.error)}</div>` : ""}
        ${errLine}
      </div>
    `;
  }

  function renderDebug(){
    if (!dbgStatus || !tabPaneDebug) return;
    dbgStatus.textContent = obs.connected ? "Connected" : "Disconnected";
    const baseTxt = (obs.baseW && obs.baseH) ? `${obs.baseW}×${obs.baseH}` : "—";
    dbgBase.textContent = baseTxt;
    dbgView.textContent = `${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`;
    (async () => {
      try {
        const s = await getActiveSceneName();
        dbgScene.textContent = s;
      } catch { dbgScene.textContent = "—"; }
    })();
    const arr = Array.from(windows.values()).filter(w => w.kind === "source");
    if (!arr.length) { dbgWindowsList.innerHTML = `<div class="hint">No source windows.</div>`; return; }
    dbgWindowsList.innerHTML = arr.map(renderDebugCard).join("");
  }

  setInterval(() => {
    if (tabPaneDebug?.classList.contains("active")) renderDebug();
  }, 1000);

  function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  /* ----------------------------- Crypto helpers --------------------------- */
  // (kept at end for clarity)
})();
