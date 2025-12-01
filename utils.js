// DOM & misc utils
export const $  = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Window/content geometry helpers
export function getWindowContentRect(winInfo){
  const cont = winInfo.el.querySelector(".win-content");
  const r = cont.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}
export function getChromeInsets(winInfo){
  const el = winInfo.el, content = el.querySelector(".win-content");
  const er = el.getBoundingClientRect(), cr = content.getBoundingClientRect();
  return { dx: Math.round(er.width-cr.width), dy: Math.round(er.height-cr.height) };
}
export function getContentInsets(winInfo){
  const el = winInfo.el, content = el.querySelector(".win-content");
  const er = el.getBoundingClientRect(), cr = content.getBoundingClientRect();
  return {
    left:Math.round(cr.left-er.left), top:Math.round(cr.top-er.top),
    right:Math.round(er.right-cr.right), bottom:Math.round(er.bottom-cr.bottom),
    dx:Math.round(er.width-cr.width), dy:Math.round(er.height-cr.height)
  };
}

// Aspect helpers
export function lockWindowToAspect(winInfo){
  if (winInfo.kind !== "source") return;
  const a = winInfo?.meta?.aspect;
  if (!a || !isFinite(a) || a <= 0) return;

  const { dx, dy } = getChromeInsets(winInfo);
  const outer = winInfo.el.getBoundingClientRect();
  
  if (!outer.width || !outer.height) return;
  if (outer.width <= dx + 16 || outer.height <= dy + 16) return;

  let cw = Math.max(1, Math.round(outer.width - dx));
  let ch = Math.max(1, Math.round(outer.height - dy));

  const th = Math.round(cw / a);
  const tw = Math.round(ch * a);
  if (Math.abs(th - ch) < Math.abs(tw - cw)) {
    ch = th;
  } else {
    cw = tw;
  }

  winInfo.el.style.width  = (cw + dx) + "px";
  winInfo.el.style.height = (ch + dy) + "px";
}

// Alignment & crop
export function decodeAlignment(bits){
  bits = Number(bits) || 0;
  const h = bits & (1|2|4), v = bits & (8|16|32);
  const ax = (h===4)?1 : (h===2)?0.5 : (h===1)?0 : (h===0)?0 : 0.5;
  const ay = (v===32)?1 : (v===16)?0.5 : (v===8)?0 : (v===0)?0 : 0.5;
  return { ax, ay };
}
export function anchorOffsetsForTransform(tr, drawW, drawH){
  const boundsType = tr?.boundsType || "OBS_BOUNDS_NONE";
  if (boundsType === "OBS_BOUNDS_NONE") return { ox:0, oy:0, ax:0, ay:0, used:"none" };
  const { ax, ay } = decodeAlignment(Number(tr?.alignment) || 0);
  const bw = Math.max(1, Math.round(Number(tr?.boundsWidth  || drawW)));
  const bh = Math.max(1, Math.round(Number(tr?.boundsHeight || drawH)));
  return { ox:bw*ax, oy:bh*ay, ax, ay, used:"bounds" };
}
export function effectiveSourceSizeFromTransform(s){
  const srcW = Math.max(1, Math.round(Number(s.sourceWidth  || 1)));
  const srcH = Math.max(1, Math.round(Number(s.sourceHeight || 1)));
  const cropL = Math.max(0, Math.round(Number(s.cropLeft   || 0)));
  const cropR = Math.max(0, Math.round(Number(s.cropRight  || 0)));
  const cropT = Math.max(0, Math.round(Number(s.cropTop    || 0)));
  const cropB = Math.max(0, Math.round(Number(s.cropBottom || 0)));
  const effW = Math.max(1, srcW - cropL - cropR);
  const effH = Math.max(1, srcH - cropT - cropB);
  return { effW, effH, srcW, srcH, cropL, cropR, cropT, cropB };

}
