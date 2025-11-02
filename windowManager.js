import { $, getChromeInsets, lockWindowToAspect } from "./utils.js";
import { writeState } from "./storage.js";

// Single source of truth for open windows
const windows = new Map();
let zTop = 10, winSeq = 1;
let onScheduleSync = null; // callback injected by sync.js

export function setSyncScheduler(fn){ onScheduleSync = fn; }
export function getWindows(){ return windows; }
export function hasWindow(id){ return windows.has(id); }
export function getWindowById(id){ return windows.get(id); }

export function createWindow(
  { title="Window", icon="🗔", content=null, width=560, height=360, x=140, y=140, id=null, kind="generic", meta=null } = {},
  taskbarTabs, desktop, tplWin
){
  const node = tplWin.content.firstElementChild.cloneNode(true);
  Object.assign(node.style, { width:width+"px", height:height+"px", left:x+"px", top:y+"px" });

  $(".win-caption", node).textContent = title;
  $(".win-icon", node).textContent = icon;
  if (content) $(".win-content", node).appendChild(content);
  desktop.appendChild(node); bringToFront(node);

  const _id = id || ("w"+(winSeq++));
  node.dataset.winId = _id;

  const tab = document.createElement("button");
  tab.className = "taskbar-tab"; tab.setAttribute("role","tab"); tab.dataset.winId=_id;
  tab.innerHTML = `<span class="tab-icon">${icon}</span><span class="tab-title">${title}</span>`;
  taskbarTabs.appendChild(tab);

  const winInfo = { id:_id, el:node, tab, title, icon, minimized:false, maximized:false, prevRect:null, kind, meta: meta || {} };
  Object.assign(winInfo.meta, { lastOrigin:null, lastStamp:0, suppressWindowToObsUntil:0, suppressObsToWindowUntil:0, last:{} });

  windows.set(_id, winInfo);

  tab.addEventListener("click", ()=> setMinimized(winInfo, !winInfo.minimized));

  setupWindowControls(winInfo);
  setupDragResize(winInfo);
  focusWindow(winInfo);

  return winInfo;
}

export function focusWindow(winInfo){
  for (const w of windows.values()) w.tab.classList.toggle("active", w.id === winInfo.id);
  bringToFront(winInfo.el);
}
export function bringToFront(el){ zTop += 1; el.style.zIndex = String(zTop); }

export function setMinimized(winInfo, value){
  winInfo.minimized = !!value;
  winInfo.el.style.display = winInfo.minimized ? "none" : "grid";
  if (!winInfo.minimized) focusWindow(winInfo);
  addWindowState(winInfo);
  if (!winInfo.minimized && onScheduleSync) onScheduleSync(winInfo);
}

export function closeWindow(winInfo){
  if (winInfo.meta?._ro){ try{ winInfo.meta._ro.disconnect(); }catch{} }
  windows.delete(winInfo.id); winInfo.el.remove(); winInfo.tab.remove();
  removeWindowState(winInfo.id);
}

export function setupWindowControls(winInfo){
  const el = winInfo.el;
  $(".win-min", el).addEventListener("click", ()=> setMinimized(winInfo, !winInfo.minimized));
  $(".win-close", el).addEventListener("click", ()=> closeWindow(winInfo));
  $(".win-max", el).addEventListener("click", ()=>{
    toggleMaximize(winInfo);
    winInfo.meta.lastOrigin='window'; winInfo.meta.lastStamp=performance.now();
  });
  el.addEventListener("mousedown", ()=> focusWindow(winInfo));
}

export function toggleMaximize(winInfo){
  if (winInfo.minimized) setMinimized(winInfo, false);
  const el = winInfo.el;
  if (!winInfo.maximized){
    winInfo.prevRect = el.getBoundingClientRect();
    const desktopRect = el.parentElement.getBoundingClientRect();
    const isSource = winInfo.kind === "source";
    const aspect = isSource ? (winInfo?.meta?.aspect || null) : null;
    const margin=8, availW=Math.round(desktopRect.width - margin*2), availH=Math.round(desktopRect.height - margin*2 - 46);
    if (isSource && aspect && isFinite(aspect) && aspect>0){
      const { dx, dy } = getChromeInsets(winInfo);
      let cw = availW-dx, ch = Math.round(cw/aspect);
      if (ch > (availH-dy)){ ch = (availH-dy); cw = Math.round(ch*aspect); }
      Object.assign(el.style, { left:(desktopRect.left+margin)+"px", top:(desktopRect.top+margin)+"px", width:(cw+dx)+"px", height:(ch+dy)+"px" });
    } else {
      Object.assign(el.style, { left:(desktopRect.left+margin)+"px", top:(desktopRect.top+margin)+"px", width:availW+"px", height:availH+"px" });
    }
    winInfo.maximized = true;
  } else {
    const r = winInfo.prevRect;
    Object.assign(el.style, { left:r.left+"px", top:r.top+"px", width:r.width+"px", height:r.height+"px" });
    winInfo.maximized = false;
  }
  if (winInfo.kind === "source") lockWindowToAspect(winInfo);
  addWindowState(winInfo); if (onScheduleSync) onScheduleSync(winInfo);
}

export function setupDragResize(winInfo){
  const el = winInfo.el, titlebar = el.querySelector(".win-titlebar"), resizer = el.querySelector(".win-resizer");

  let dragging=false, offsetX=0, offsetY=0;
  titlebar.addEventListener("mousedown", (e)=>{
    if (e.target.closest(".win-controls")) return;
    dragging=true; const rect=el.getBoundingClientRect(); offsetX=e.clientX-rect.left; offsetY=e.clientY-rect.top;
    const onMove=(ev)=>{ if(!dragging) return;
      const x=Math.min(window.innerWidth-100, Math.max(0, ev.clientX-offsetX));
      const maxH=window.innerHeight-46, y=Math.min(maxH-60, Math.max(0, ev.clientY-offsetY));
      el.style.left=x+"px"; el.style.top=y+"px";
      winInfo.meta.lastOrigin='window'; winInfo.meta.lastStamp=performance.now();
      if (onScheduleSync) onScheduleSync(winInfo);
    };
    const onUp=()=>{ dragging=false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); addWindowState(winInfo); if (onScheduleSync) onScheduleSync(winInfo); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  });

  let resizing=false, startW=0, startH=0, startX=0, startY=0;
  resizer.addEventListener("mousedown", (e)=>{
    resizing=true; const r=el.getBoundingClientRect(); startW=r.width; startH=r.height; startX=e.clientX; startY=e.clientY;
    const onResize=(ev)=>{ if(!resizing) return;
      const dx=ev.clientX-startX, dy=ev.clientY-startY;
      const isSource = winInfo.kind === "source"; const a = winInfo?.meta?.aspect || null;
      const { dx:chromeX, dy:chromeY } = getChromeInsets(winInfo);
      if (isSource && a && isFinite(a) && a>0){
        const startOuter = el.getBoundingClientRect();
        let cw = Math.max(1, Math.round(startOuter.width - chromeX)) + dx;
        let ch = Math.max(1, Math.round(startOuter.height - chromeY)) + dy;
        if (Math.abs(dx) >= Math.abs(dy)) { cw = Math.max(320, cw); ch = Math.round(cw / a); }
        else { ch = Math.max(240, ch); cw = Math.round(ch * a); }
        el.style.width = (cw+chromeX)+"px"; el.style.height=(ch+chromeY)+"px";
      } else {
        el.style.width = Math.max(240, startW+dx)+"px"; el.style.height = Math.max(160, startH+dy)+"px";
      }
      winInfo.meta.lastOrigin='window'; winInfo.meta.lastStamp=performance.now();
      if (onScheduleSync) onScheduleSync(winInfo);
    };
    const onUp=()=>{ resizing=false; document.removeEventListener("mousemove", onResize); document.removeEventListener("mouseup", onUp);
      if (winInfo.kind === "source") lockWindowToAspect(winInfo); addWindowState(winInfo); if (onScheduleSync) onScheduleSync(winInfo); };
    document.addEventListener("mousemove", onResize); document.addEventListener("mouseup", onUp); e.preventDefault();
  });
}

// Persistence (source windows only)
export function addWindowState(winInfo){
  if (winInfo.kind!=="source") return;
  const rect = winInfo.el.getBoundingClientRect();
  const content = winInfo.el.querySelector(".win-content").getBoundingClientRect();
  const entry = {
    kind:"source", id:winInfo.id, title:winInfo.title, icon:winInfo.icon,
    x:Math.round(rect.left), y:Math.round(rect.top), w:Math.round(rect.width), h:Math.round(rect.height),
    minimized:!!winInfo.minimized, maximized:!!winInfo.maximized,
    sourceName:winInfo.meta?.sourceName||"", interval:winInfo.meta?.interval||500,
    cx:Math.round(content.left), cy:Math.round(content.top), cw:Math.round(content.width), ch:Math.round(content.height),
    aspect:winInfo.meta?.aspect||null
  };
  const state = JSON.parse(localStorage.getItem("win_desktop_state_v1")||"{\"windows\":[]}");
  const i = (state.windows||[]).findIndex(w=>w.id===entry.id);
  if (i>=0) state.windows[i]=entry; else state.windows.push(entry);
  writeState(state);
}
export function removeWindowState(id){
  const state = JSON.parse(localStorage.getItem("win_desktop_state_v1")||"{\"windows\":[]}");
  state.windows = (state.windows||[]).filter(w=>w.id!==id);
  writeState(state);
}
