import { getWindows, setSyncScheduler, addWindowState } from "./windowManager.js";
import { getActiveSceneName } from "./obsClient.js";
import { getWindowContentRect, getContentInsets, effectiveSourceSizeFromTransform, anchorOffsetsForTransform, lockWindowToAspect } from "./utils.js";

const owningSceneCache = new Map(); // sourceName -> { sceneName, sceneItemId }
const pendingSyncs = new Set();

let obsRef = null;
export function attachOBS(obs){ obsRef = obs; }
export function initSync(){ setSyncScheduler(scheduleSync); }

export function handleOBSEvent(ev){
  const t = ev?.eventType || "";
  if (t === "SceneItemTransformChanged"){
    const d = ev?.eventData || {};
    const sceneName = d?.sceneName, sceneItemId = d?.sceneItemId;
    if (sceneName == null || sceneItemId == null) return;
    for (const w of getWindows().values()){
      if (w.kind!=="source") continue;
      if (w.meta?.owningScene===sceneName && w.meta?.sceneItemId===sceneItemId){
        const now = performance.now();
        if (now < (w.meta.suppressObsToWindowUntil || 0)) return;
        applyObsTransformToWindow(w).catch(e=>{ w.meta.last.error = e.message; });
        break;
      }
    }
  } else if (t==="CurrentProgramSceneChanged" || t==="CurrentPreviewSceneChanged" || t==="SceneItemCreated" || t==="SceneItemRemoved" || t==="VideoSettingsChanged"){
    for (const w of getWindows().values()) scheduleSync(w);
  }
}

export function scheduleSync(winInfo){
  if (!winInfo) return;
  const now = performance.now();
  if (now < (winInfo.meta.suppressWindowToObsUntil || 0)) return;
  if (pendingSyncs.has(winInfo.id)) return;
  pendingSyncs.add(winInfo.id);
  requestAnimationFrame(()=>{ pendingSyncs.delete(winInfo.id); syncObsItemToWindow(winInfo).catch(e=>{ winInfo.meta.last.error=e.message; }); });
}

export async function findOwningSceneAndItemId(obs, sourceName){
  const cached = owningSceneCache.get(sourceName);
  if (cached?.sceneName && cached?.sceneItemId) return cached;
  const scenes = await obs.request("GetSceneList", {}); const list = Array.isArray(scenes?.scenes)?scenes.scenes:[];
  for (const sc of list){
    const sceneName = sc?.sceneName || sc?.name; if (!sceneName) continue;
    const items = await obs.request("GetSceneItemList", { sceneName });
    const arr = Array.isArray(items?.sceneItems)?items.sceneItems:[];
    const hit = arr.find(it=>it?.sourceName===sourceName);
    if (hit?.sceneItemId!=null){ const res={sceneName, sceneItemId:hit.sceneItemId}; owningSceneCache.set(sourceName,res); return res; }
  }
  try {
    const groups = await obs.request("GetGroupList", {}); const gnames = Array.isArray(groups?.groups)?groups.groups:[];
    for (const g of gnames){
      const gitems = await obs.request("GetGroupSceneItemList", { sceneName:g });
      const arr = Array.isArray(gitems?.sceneItems)?gitems.sceneItems:[];
      const hit = arr.find(it=>it?.sourceName===sourceName);
      if (hit?.sceneItemId!=null){ const res={sceneName:g, sceneItemId:hit.sceneItemId}; owningSceneCache.set(sourceName,res); return res; }
    }
  } catch {}
  throw new Error(`Source "${sourceName}" not found in any scene/group.`);
}

export async function syncObsItemToWindow(winInfo){
  if (winInfo.kind!=="source" || !obsRef?.connected) return;

  if (!obsRef.baseW || !obsRef.baseH){ await obsRef.refreshVideoSettings().catch(()=>{}); }

  if (!winInfo.meta.owningScene || !winInfo.meta.sceneItemId){
    const r = await findOwningSceneAndItemId(obsRef, winInfo.meta.sourceName);
    winInfo.meta.owningScene = r.sceneName; winInfo.meta.sceneItemId = r.sceneItemId;
  }

  const { x, y, w, h } = getWindowContentRect(winInfo); if (w<=0 || h<=0) return;

  // CSS → base canvas
  const cssW = document.documentElement.clientWidth, cssH = document.documentElement.clientHeight;
  const baseW = obsRef.baseW || cssW, baseH = obsRef.baseH || cssH;
  const sx = baseW/cssW, sy = baseH/cssH;
  const mapped = { x:Math.round(x*sx), y:Math.round(y*sy), w:Math.max(1,Math.round(w*sx)), h:Math.max(1,Math.round(h*sy)) };

  // Read transform to get current crop
  const tr = await obsRef.request("GetSceneItemTransform", { sceneName:winInfo.meta.owningScene, sceneItemId:winInfo.meta.sceneItemId });
  const s = tr?.sceneItemTransform || {};
  const { effW, effH } = effectiveSourceSizeFromTransform(s);
  const scale = Math.max(0.0001, Math.min(mapped.w/effW, mapped.h/effH));

  const transform = { positionX: mapped.x, positionY: mapped.y, rotation:0, scaleX:scale, scaleY:scale, boundsType:"OBS_BOUNDS_NONE" };

  // mark: window drove
  const hush=250; winInfo.meta.lastOrigin='window'; winInfo.meta.lastStamp=performance.now(); winInfo.meta.suppressObsToWindowUntil = winInfo.meta.lastStamp + hush;

  await obsRef.request("SetSceneItemTransform", { sceneName:winInfo.meta.owningScene, sceneItemId:winInfo.meta.sceneItemId, sceneItemTransform: transform });

  winInfo.meta.last = { mappedX:mapped.x, mappedY:mapped.y, mappedW:mapped.w, mappedH:mapped.h, scale, error:"" };
}

export async function applyObsTransformToWindow(winInfo){
  if (!obsRef?.connected) return;
  const tr = await obsRef.request("GetSceneItemTransform", { sceneName:winInfo.meta.owningScene, sceneItemId:winInfo.meta.sceneItemId });
  const s = tr?.sceneItemTransform || {};

  const { effW, effH } = effectiveSourceSizeFromTransform(s);
  const scaleX = Number(s.scaleX||1), scaleY = Number(s.scaleY||1);
  const drawW = Math.max(1, Math.round(effW*scaleX)), drawH = Math.max(1, Math.round(effH*scaleY));

  const { ox, oy } = anchorOffsetsForTransform(s, drawW, drawH);

  const cssW = document.documentElement.clientWidth, cssH = document.documentElement.clientHeight;
  const baseW = obsRef.baseW || cssW, baseH = obsRef.baseH || cssH;
  const invSX = cssW/baseW, invSY = cssH/baseH;

  const contentLeft = (Number(s.positionX||0) - ox) * invSX;
  const contentTop  = (Number(s.positionY||0) - oy) * invSY;
  const contentW    = drawW * invSX;
  const contentH    = drawH * invSY;

  const insets = getContentInsets(winInfo);
  winInfo.el.style.left   = (Math.round(contentLeft)-insets.left) + "px";
  winInfo.el.style.top    = (Math.round(contentTop)-insets.top)   + "px";
  winInfo.el.style.width  = (Math.round(contentW)+insets.dx)      + "px";
  winInfo.el.style.height = (Math.round(contentH)+insets.dy)      + "px";

  // OBS drove → suppress echo
  const hush=250; winInfo.meta.lastOrigin='obs'; winInfo.meta.lastStamp=performance.now(); winInfo.meta.suppressWindowToObsUntil = winInfo.meta.lastStamp + hush;

  addWindowState(winInfo);
  if (winInfo.kind === "source") lockWindowToAspect(winInfo);
}