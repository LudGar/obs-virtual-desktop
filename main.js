import { $, $$, escapeHtml } from "./utils.js";
import { readState, writeState, readObsSettings, writeObsSettings } from "./storage.js";
import { OBSClient } from "./obsClient.js";
import { createWindow, getWindows } from "./windowManager.js";
import { attachOBS, initSync, handleOBSEvent, scheduleSync } from "./sync.js";
import { attachOBSForCatalog, wireCatalogUI, createSourceWindow } from "./catalog.js";

// DOM refs
const desktop = $("#desktop");
const taskbarTabs = $("#taskbar-tabs");
const startBtn = $("#start-btn");
const startMenu = $("#start-menu");
const dateEl = $("#taskbar-date");
const clockEl = $("#taskbar-clock");
const tplWin = $("#window-template");

const obsStatusBtn = $("#obs-status-btn");
const obsDot = $("#obs-dot");

const obsSettingsPanel = $("#obs-settings");
const connectForm = $("#obs-connect-form");
const obsPort = $("#obs-port");
const obsPass = $("#obs-pass");
const obsStatus = $("#obs-status");
const btnDisconnect = $("#obs-disconnect");
const btnResetSources = $("#obs-reset-sources");

const tabBtnSettings = $("#obs-tab-settings");
const tabBtnDebug = $("#obs-tab-debug");
const tabPaneSettings = $("#obs-tabpane-settings");
const tabPaneDebug = $("#obs-tabpane-debug");

const dbgStatus = $("#dbg-status");
const dbgBase = $("#dbg-base");
const dbgView = $("#dbg-view");
const dbgScene = $("#dbg-scene");
const dbgWindowsList = $("#dbg-windows-list");

const sourceDialog = $("#source-dialog");
const sourceGrid = $("#source-grid");
const sourceRefreshBtn = $("#source-refresh");
const sourceHint = $("#source-hint");
const startNewSource = $("#start-new-source");
const sourceCreateBtn = $("#source-create");
const sourceCancelBtn = $("#source-cancel");
const sourceCustomTitle = $("#source-custom-title");

// Clock
function updateClock(){
  const now = new Date();
  const dd = String(now.getDate()).padStart(2,"0");
  const mm = String(now.getMonth()+1).padStart(2,"0");
  const yyyy = now.getFullYear();
  dateEl.textContent = `${dd}/${mm}/${yyyy}`;
  clockEl.textContent = now.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
updateClock(); setInterval(updateClock, 1000);

// Start menu + open source picker
startBtn.addEventListener("click", ()=> startMenu.hidden = !startMenu.hidden);
document.addEventListener("click", (e)=>{ if (!startMenu.hidden && !startMenu.contains(e.target) && e.target!==startBtn) startMenu.hidden = true; });
startNewSource.addEventListener("click", ()=>{
  startMenu.hidden=true; openSourceDialog();
  // Reset picker controls and populate
  if (sourceCreateBtn) sourceCreateBtn.disabled = true;
  if (sourceCustomTitle) sourceCustomTitle.value = "";
  sourceRefreshBtn?.click();
});

function openSourceDialog(){
  const container = document.createElement("div"); container.appendChild(sourceDialog);
  sourceDialog.classList.remove("hidden");
  createWindow({ title:"Add Source Window", icon:"🖼️", content:container, width:680, height:520, x:160, y:120, kind:"generic" }, taskbarTabs, desktop, tplWin);
}

// OBS status dot helper
function setObsIndicator(stateText){
  obsStatusBtn.title = `OBS: ${stateText}`;
  obsDot.title = stateText;
  let color = "var(--red)";
  if (/connect/i.test(stateText) && /ing/.test(stateText)) color = "var(--yellow)";
  else if (/connected/i.test(stateText)) color = "var(--green)";
  obsDot.style.background = color;
}
obsStatusBtn.addEventListener("click", ()=> openObsSettingsWindow());
function openObsSettingsWindow(){
  const content = document.createElement("div"); content.appendChild(obsSettingsPanel);
  obsSettingsPanel.classList.remove("hidden");
  createWindow({ title:"OBS Settings", icon:"⚙️", content, width:640, height:380, x:120, y:100, kind:"generic" }, taskbarTabs, desktop, tplWin);
  const saved = readObsSettings();
  if (saved?.port) obsPort.value = String(saved.port);
  if (typeof saved?.password==="string") obsPass.value=saved.password;
  renderDebug();
}

// Tabs
function setTab(which){
  const settingsActive = which==="settings";
  tabBtnSettings.classList.toggle("active", settingsActive);
  tabBtnDebug.classList.toggle("active", !settingsActive);
  tabPaneSettings.classList.toggle("active", settingsActive);
  tabPaneDebug.classList.toggle("active", !settingsActive);
}
tabBtnSettings?.addEventListener("click", ()=> setTab("settings"));
tabBtnDebug?.addEventListener("click", ()=>{ setTab("debug"); renderDebug(); });

// OBS client & sync
const obs = new OBSClient();
attachOBS(obs);
attachOBSForCatalog(obs);
initSync();
setObsIndicator("Disconnected");

// Wire catalog UI
wireCatalogUI({ sourceDialog, sourceGrid, sourceHint, sourceRefreshBtn, sourceCreateBtn, sourceCancelBtn, sourceCustomTitle, taskbarTabs, desktop, tplWin });

// Connect / disconnect
async function attachHandlersAfterConnect(){
  obs.onEvent = (d)=>{
    if (d?.eventType==="__DISCONNECTED__"){
      obsStatus.textContent="Disconnected";
      setObsIndicator("Disconnected");        // <-- ensure dot flips to red on *any* disconnect
    } else {
      handleOBSEvent(d);
      renderDebug();
    }
  };
}

connectForm.addEventListener("submit", async (e)=>{
  e.preventDefault();
  try {
    obsStatus.textContent="Connecting…"; setObsIndicator("Connecting…");
    await obs.connect("127.0.0.1", Number(obsPort.value)||4455, obsPass.value||"");
    await attachHandlersAfterConnect();
    obsStatus.textContent="Connected"; setObsIndicator("Connected");
    writeObsSettings({ host:"127.0.0.1", port:Number(obsPort.value)||4455, password:obsPass.value||"" });
  } catch (err) {
    obsStatus.textContent="Connection failed: "+err.message;
    setObsIndicator("Disconnected");          // <-- ensure red on failed connect
  }
});

btnDisconnect?.addEventListener("click", async ()=>{
  await obs.disconnect();
  obsStatus.textContent="Disconnected";
  setObsIndicator("Disconnected");            // <-- ensure red on manual disconnect
});

// Reset (remove source windows)
btnResetSources?.addEventListener("click", ()=>{
  const wins = Array.from(getWindows().values()).filter(w=>w.kind==="source");
  let c=0; for (const w of wins){ const btn = w.el.querySelector(".win-close"); if (btn) btn.click(); else { w.el.remove(); w.tab.remove(); } c++; }
  const s = readState(); s.windows=[]; writeState(s);
  obsStatus.textContent = `Removed ${c} source window${c===1?"":"s"}.`; renderDebug();
});

// Restore previous (guarded)
let _didRestore = false;
restoreAll();

async function restoreAll(){
  if (_didRestore) return;
  _didRestore = true;

  const savedObs = readObsSettings();
  if (savedObs?.port) obsPort.value=String(savedObs.port);
  if (typeof savedObs?.password==="string") obsPass.value=savedObs.password;

  if (savedObs?.port!=null){
    try {
      obsStatus.textContent="Connecting…"; setObsIndicator("Connecting…");
      await obs.connect(savedObs.host||"127.0.0.1", Number(savedObs.port)||4455, savedObs.password||"");
      await attachHandlersAfterConnect();
      obsStatus.textContent="Connected"; setObsIndicator("Connected");
    } catch {
      obsStatus.textContent="Disconnected"; setObsIndicator("Disconnected");
    }
  }

  const state = readState();
  const wins = Array.isArray(state.windows)?state.windows:[];
  for (const w of wins){
    if (w.kind!=="source") continue;
    const titleOverride = w.title || w.sourceName || "Source";
    await createSourceWindow(
      w.sourceName || w.title || "Source",
      { titleOverride, taskbarTabs, desktop, tplWin, sourceDialog, restore: w }
    );
  }
}

// Window resize → resync
window.addEventListener("resize", ()=>{ for (const w of getWindows().values()) scheduleSync(w); renderDebug(); });

// Debug
function renderDebug(){
  if (!dbgStatus || !tabPaneDebug) return;
  dbgStatus.textContent = obs.connected ? "Connected" : "Disconnected";
  const baseTxt = (obs.baseW && obs.baseH) ? `${obs.baseW}×${obs.baseH}` : "—";
  dbgBase.textContent = baseTxt;
  dbgView.textContent = `${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`;
  (async()=>{ try{ const s = await obs.request("GetCurrentProgramScene", {}); dbgScene.textContent = s?.currentProgramSceneName || s?.sceneName || "—"; }catch{ dbgScene.textContent="—"; } })();
  const arr = Array.from(getWindows().values()).filter(w=>w.kind==="source");
  if (!arr.length){ dbgWindowsList.innerHTML=`<div class="hint">No source windows.</div>`; return; }
  dbgWindowsList.innerHTML = arr.map(w=>{
    const last=w.meta.last||{}; const ownScene=w.meta.owningScene||"—"; const sid=(w.meta.sceneItemId!=null)?String(w.meta.sceneItemId):"—";
    const aspect = w.meta.aspect ? Number(w.meta.aspect).toFixed(4) : "—";
    const err = last.error ? `<div class="dbg-row dbg-err">${escapeHtml(last.error)}</div>` : "";
    return `<div class="dbg-card">
      <div class="dbg-row"><span class="k">Title:</span><span class="v">${escapeHtml(w.title)}</span></div>
      <div class="dbg-row"><span class="k">Source:</span><span class="v">${escapeHtml(w.meta.sourceName)}</span></div>
      <div class="dbg-row"><span class="k">Scene:</span><span class="v">${escapeHtml(ownScene)}</span><span class="k">ItemId:</span><span class="v">${sid}</span></div>
      <div class="dbg-row"><span class="k">Aspect:</span><span class="v">${aspect}</span></div>
      <div class="dbg-row"><span class="k">Mapped:</span><span class="v">${last.mappedX??"—"},${last.mappedY??"—"} ${last.mappedW??"—"}×${last.mappedH??"—"}</span></div>
      <div class="dbg-row"><span class="k">Scale:</span><span class="v">${last.scale?Number(last.scale).toFixed(4):"—"}</span></div>
      ${err}
    </div>`;
  }).join("");
}
