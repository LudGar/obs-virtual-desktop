// Minimal OBS v5 client with auth + basic helpers
export const OBS_OP = { Hello:0, Identify:1, Identified:2, Reidentify:3, Event:5, Request:6, RequestResponse:7 };

export class OBSClient {
  constructor(){
    this.ws=null; this.connected=false; this.reqIdSeq=1; this.pending=new Map();
    this.hello=null; this.password=""; this.baseW=0; this.baseH=0; this.onEvent=()=>{};
  }

  async connect(host="127.0.0.1", port=4455, password=""){
    await this.disconnect(); // ensure clean slate
    return new Promise((resolve, reject)=>{
      try { this.ws = new WebSocket(`ws://${host}:${port}`); }
      catch(e){ this._emitDisconnected(); return reject(e); }
      this.password = password;

      this.ws.addEventListener("error", () => {
        this._emitDisconnected();
        reject(new Error("WebSocket error"));
      });

      this.ws.addEventListener("close", () => {
        this.connected=false;
        this.pending.forEach(p=>p.reject(new Error("OBS disconnected")));
        this.pending.clear();
        this._emitDisconnected();
      });

      this.ws.addEventListener("message", async (ev)=>{
        const msg = JSON.parse(ev.data);
        if (msg.op === OBS_OP.Hello){
          this.hello = msg.d;
          try {
            const ident = await buildIdentify(this.hello, this.password);
            this.ws.send(JSON.stringify({ op: OBS_OP.Identify, d: ident }));
          } catch (e) {
            this._emitDisconnected();
            reject(e);
          }
        } else if (msg.op === OBS_OP.Identified){
          this.connected = true;
          try { await this.refreshVideoSettings(); } catch {}
          resolve();
        } else if (msg.op === OBS_OP.Event){
          this.onEvent(msg.d);
          if (msg?.d?.eventType === "VideoSettingsChanged"){
            this.refreshVideoSettings().catch(()=>{});
          }
        } else if (msg.op === OBS_OP.RequestResponse){
          const { requestId, requestStatus } = msg.d;
          const pend = this.pending.get(requestId);
          if (pend){
            this.pending.delete(requestId);
            requestStatus?.result ? pend.resolve(msg.d.responseData||{}) : pend.reject(new Error(requestStatus?.comment || "OBS request failed"));
          }
        }
      });
    });
  }

  async refreshVideoSettings(){
    const v = await this.request("GetVideoSettings", {});
    this.baseW = Number(v?.baseWidth||0);
    this.baseH = Number(v?.baseHeight||0);
  }

  async disconnect(){
    if (this.ws){
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    const wasConnected = this.connected;
    this.connected = false;
    // proactively tell UI even if close event already fired or never fires
    if (wasConnected) this._emitDisconnected();
  }

  async request(type, data={}){
    if (!this.ws || !this.connected) throw new Error("Not connected");
    const requestId = String(this.reqIdSeq++);
    const payload = { op: OBS_OP.Request, d: { requestType:type, requestId, requestData:data } };
    const p = new Promise((resolve,reject)=>this.pending.set(requestId,{resolve,reject}));
    this.ws.send(JSON.stringify(payload));
    return p;
  }

  async getInputs(){
    try { const d = await this.request("GetInputList", {}); return Array.isArray(d?.inputs)?d.inputs:[]; }
    catch { return []; }
  }

  _emitDisconnected(){
    try { this.onEvent({ eventType: "__DISCONNECTED__" }); } catch {}
  }
}

async function buildIdentify(hello, password){
  const ident = { rpcVersion: hello.rpcVersion, eventSubscriptions: 0xFFFFFFFF };
  if (!hello.authentication) return ident;
  const { challenge, salt } = hello.authentication;
  ident.authentication = await computeAuth(password, salt, challenge);
  return ident;
}

async function computeAuth(password, saltB64, challengeB64){
  const salt = base64ToBytes(saltB64), challenge = base64ToBytes(challengeB64);
  const secret = await sha256Bytes(concatBytes(utf8Bytes(password), salt));
  const secretB64 = bytesToBase64(secret);
  const final = await sha256Bytes(concatBytes(utf8Bytes(secretB64), challenge));
  return bytesToBase64(final);
}
const utf8Bytes=(s)=>new TextEncoder().encode(s);
const concatBytes=(a,b)=>{const c=new Uint8Array(a.length+b.length); c.set(a,0); c.set(b,a.length); return c;};
const sha256Bytes=async(bytes)=>new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const bytesToBase64=(bytes)=>{let s=""; bytes.forEach(b=>s+=String.fromCharCode(b)); return btoa(s);};
const base64ToBytes=(b64)=>{const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out;};

// Helper to get the ACTIVE scene (program if available)
export async function getActiveSceneName(obs){
  try { const prog = await obs.request("GetCurrentProgramScene", {}); const n=prog?.currentProgramSceneName||prog?.sceneName; if (n) return n; } catch{}
  try {
    const studio = await obs.request("GetStudioModeEnabled", {});
    if (studio?.studioModeEnabled){
      const prev = await obs.request("GetCurrentPreviewScene", {});
      const n = prev?.currentPreviewSceneName || prev?.sceneName;
      if (n) return n;
    }
  } catch{}
  const list = await obs.request("GetSceneList", {});
  const scenes = Array.isArray(list?.scenes)?list.scenes:[];
  if (scenes[0]?.sceneName) return scenes[0].sceneName;
  throw new Error("No active scene found");
}