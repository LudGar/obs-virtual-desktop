const STORE_KEY = "win_desktop_state_v1";
const STORE_OBS  = "obs_settings_v1";

export function readState(){ try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; } }
export function writeState(s){ localStorage.setItem(STORE_KEY, JSON.stringify(s)); }

export function readObsSettings(){ try { return JSON.parse(localStorage.getItem(STORE_OBS) || "{}"); } catch { return {}; } }
export function writeObsSettings(obj){ localStorage.setItem(STORE_OBS, JSON.stringify(obj)); }