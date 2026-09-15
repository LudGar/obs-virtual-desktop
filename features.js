/* ------------------------------------------------------------------
   OBS Studio Taskbar Control — Erweiterungen

   Diese Datei hängt sich an die bestehenden Funktionen an, statt sie zu
   ersetzen. script.js bleibt unverändert; wird features.js entfernt,
   verhält sich das Tool wieder wie vorher.

   Drin sind drei Sachen:
     1. Verbindung merken und beim Start automatisch aufbauen
     2. Rechtsklick auf Fenster oder Tab öffnet ein kleines Menü
     3. Quellen, die gerade nicht in der Szene liegen, lassen sich
        trotzdem öffnen — mit der zuletzt bekannten Lage und Größe
------------------------------------------------------------------ */

(() => {
  "use strict";

  const SCHLUESSEL = "obs-taskbar:v1";

  const leer = { verbindung: null, autoVerbinden: true, passwortMerken: false, geometrie: {} };

  function laden() {
    try { return Object.assign({}, leer, JSON.parse(localStorage.getItem(SCHLUESSEL)) || {}); }
    catch (e) { return Object.assign({}, leer); }
  }
  let daten = laden();

  let sicherTimer = null;
  function sichern() {
    clearTimeout(sicherTimer);
    sicherTimer = setTimeout(() => {
      try { localStorage.setItem(SCHLUESSEL, JSON.stringify(daten)); }
      catch (e) { console.warn("Einstellungen lassen sich nicht speichern:", e); }
    }, 300);
  }

  /* ================================================================
     1. Verbindung merken und automatisch aufbauen
  ================================================================ */

  function baueEinstellungen() {
    const gruppe = document.querySelector("#settings-panel .button-group");
    if (!gruppe || document.getElementById("auto-connect")) return;

    const kasten = document.createElement("div");
    kasten.className = "merk-optionen";

    kasten.appendChild(schalter("auto-connect", "Beim Start automatisch verbinden", daten.autoVerbinden,
      v => { daten.autoVerbinden = v; sichern(); }));
    kasten.appendChild(schalter("save-password", "Passwort mitspeichern", daten.passwortMerken,
      v => {
        daten.passwortMerken = v;
        if (!v && daten.verbindung) daten.verbindung.passwort = "";
        sichern();
      }));

    const hinweis = document.createElement("p");
    hinweis.className = "merk-hinweis";
    hinweis.textContent = "Adresse und Häkchen liegen im localStorage dieses Browsers. "
                        + "Das Passwort wird nur gespeichert, wenn du es hier erlaubst.";
    kasten.appendChild(hinweis);

    gruppe.parentNode.insertBefore(kasten, gruppe);
  }

  function schalter(id, text, wert, beiAenderung) {
    const label = document.createElement("label");
    label.className = "merk-schalter";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = id;
    box.checked = !!wert;
    box.addEventListener("change", () => beiAenderung(box.checked));
    label.appendChild(box);
    label.appendChild(document.createTextNode(text));
    return label;
  }

  function verbindungMerken() {
    const adresse = (wsAddress && wsAddress.value) || "";
    const passwort = (wsPassword && wsPassword.value) || "";
    daten.verbindung = { adresse, passwort: daten.passwortMerken ? passwort : "" };
    sichern();
  }

  function felderFuellen() {
    if (!daten.verbindung) return;
    if (wsAddress && daten.verbindung.adresse) wsAddress.value = daten.verbindung.adresse;
    if (wsPassword && daten.verbindung.passwort) wsPassword.value = daten.verbindung.passwort;
  }

  /* Die Knöpfe hängen schon am Original, ein Umschließen käme dort nie an.
     Deshalb wird der Verbindungszustand beobachtet statt die Funktion ersetzt. */
  let warVerbunden = false;
  let vonHandGetrennt = false;

  setInterval(() => {
    const jetzt = (typeof connected !== "undefined") && connected;
    if (jetzt && !warVerbunden) { verbindungMerken(); vonHandGetrennt = false; }
    if (!jetzt && warVerbunden) { vonHandGetrennt = true; }
    warVerbunden = jetzt;
  }, 500);

  async function automatischVerbinden() {
    if (!daten.autoVerbinden || !daten.verbindung || !daten.verbindung.adresse) return;

    /* auf die WebSocket-Bibliothek warten, die lädt asynchron vom CDN */
    for (let i = 0; i < 100; i++) {
      if (typeof libraryLoaded !== "undefined" && libraryLoaded) break;
      await new Promise(r => setTimeout(r, 100));
    }
    if (typeof libraryLoaded === "undefined" || !libraryLoaded) return;
    if (typeof connected !== "undefined" && connected) return;
    if (vonHandGetrennt) return;

    felderFuellen();
    if (statusSubtitle) statusSubtitle.textContent = "Verbinde mit OBS …";
    try {
      await connectToOBS();
    } catch (e) { /* Fehlermeldung zeigt connectToOBS selbst */ }

    if (typeof connected !== "undefined" && !connected && statusSubtitle) {
      statusSubtitle.textContent = "Keine Verbindung — über Start einrichten";
    }
  }

  /* ================================================================
     2. Rechtsklick auf Fenster und Tabs
  ================================================================ */

  let menu = null;

  function menuSchliessen() {
    if (menu) { menu.remove(); menu = null; }
  }

  function menuOeffnen(x, y, eintraege) {
    menuSchliessen();
    menu = document.createElement("div");
    menu.className = "kontextmenue";
    eintraege.forEach(e => {
      if (e.trenner) {
        const tr = document.createElement("div");
        tr.className = "kontext-trenner";
        menu.appendChild(tr);
        return;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = e.text;
      if (e.gefahr) b.className = "gefahr";
      b.addEventListener("click", () => { menuSchliessen(); e.tun(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);

    /* am Rand umklappen, damit nichts aus dem Bild läuft */
    const b = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth  - b.width  - 6) + "px";
    menu.style.top  = Math.min(y, window.innerHeight - b.height - 6) + "px";
  }

  function fensterZuId(el) {
    const f = el.closest(".fake-window");
    if (f) return parseInt(f.id.replace("window-", ""), 10);
    const t = el.closest(".window-tab");
    if (t) return parseInt(t.id.replace("tab-", ""), 10);
    return null;
  }

  document.addEventListener("contextmenu", e => {
    const id = fensterZuId(e.target);
    if (id === null || Number.isNaN(id)) return;
    const w = windows.find(x => x.id === id);
    if (!w) return;
    e.preventDefault();

    menuOeffnen(e.clientX, e.clientY, [
      { text: "In den Vordergrund", tun: () => { if (!w.minimized) focusWindow(w.element); else toggleWindow(id); } },
      { text: w.minimized ? "Wiederherstellen" : "Minimieren", tun: () => toggleWindow(id) },
      { trenner: true },
      { text: "Schließen", gefahr: true, tun: () => closeWindow(id) }
    ]);
  });

  document.addEventListener("click", menuSchliessen);
  document.addEventListener("scroll", menuSchliessen, true);
  window.addEventListener("blur", menuSchliessen);
  document.addEventListener("keydown", e => { if (e.key === "Escape") menuSchliessen(); });

  /* ================================================================
     3. Lage und Größe merken, auch für fehlende Quellen
  ================================================================ */

  function merke(w) {
    if (!w || !w.element || !w.title) return;
    const x = parseInt(w.element.style.left, 10);
    const y = parseInt(w.element.style.top, 10);
    const br = parseInt(w.element.style.width, 10);
    const ho = parseInt(w.element.style.height, 10);
    if ([x, y, br, ho].some(n => Number.isNaN(n))) return;
    if (w.minimized) return;                 // minimiert steht das Fenster geparkt

    daten.geometrie[w.title] = {
      x, y, breite: br, hoehe: ho,
      szene: (typeof currentScene !== "undefined" ? currentScene : "") || "",
      stand: Date.now()
    };
    sichern();
  }

  setInterval(() => {
    if (!Array.isArray(windows)) return;
    windows.forEach(merke);
  }, 2000);

  /* Quellen, die gespeichert sind, aber gerade nicht in der Szene liegen */
  function fehlendeQuellen() {
    const vorhanden = new Set((Array.isArray(sources) ? sources : []).map(s => s.sourceName));
    const offen = new Set((Array.isArray(windows) ? windows : []).map(w => w.title));
    return Object.keys(daten.geometrie)
      .filter(name => !vorhanden.has(name) && !offen.has(name))
      .sort((a, b) => daten.geometrie[b].stand - daten.geometrie[a].stand);
  }

  function entkoppeltOeffnen(name) {
    const g = daten.geometrie[name];
    if (!g) return;
    /* createFakeWindow erwartet die Inhaltshöhe, die Titelleiste kommt dort dazu */
    const inhalt = Math.max(40, g.hoehe - TITLEBAR_HEIGHT);
    createFakeWindow(name, g.breite, inhalt, null, g.x, g.y);
    const w = windows[windows.length - 1];
    if (w) {
      w.entkoppelt = true;
      w.element.classList.add("entkoppelt");
      const titel = w.element.querySelector(".window-title");
      if (titel) titel.textContent = name;
      kennzeichnen(w, "nicht in dieser Szene");
    }
  }

  function kennzeichnen(w, text) {
    let marke = w.element.querySelector(".entkoppelt-marke");
    if (!text) { if (marke) marke.remove(); return; }
    if (!marke) {
      marke = document.createElement("div");
      marke.className = "entkoppelt-marke";
      const inhalt = w.element.querySelector(".window-content");
      (inhalt || w.element).appendChild(marke);
    }
    marke.textContent = text;
  }

  /* Liste im Startmenü um die fehlenden Quellen ergänzen */
  const _renderSources = window.renderSources;
  window.renderSources = function () {
    _renderSources.apply(this, arguments);

    const fehlend = fehlendeQuellen();
    if (!fehlend.length) return;

    const kopf = document.createElement("div");
    kopf.className = "quellen-rubrik";
    kopf.textContent = "Zuletzt bekannt";
    sourcesList.appendChild(kopf);

    fehlend.forEach(name => {
      const g = daten.geometrie[name];
      const item = document.createElement("div");
      item.className = "source-item clickable entkoppelt-eintrag";
      item.onclick = () => {
        entkoppeltOeffnen(name);
        hideSourcesList();
        closeStartMenu();
      };
      item.innerHTML = `
        <div class="source-checkbox">–</div>
        <div class="source-info">
          <div class="source-name">${name}</div>
          <div class="source-type">${g.breite} × ${g.hoehe}${g.szene ? " · " + g.szene : ""}</div>
        </div>`;
      sourcesList.appendChild(item);
    });
  };

  /* Taucht die Quelle wieder auf, wird das Fenster wieder angekoppelt */
  const _loadSources = window.loadSources;
  window.loadSources = async function () {
    await _loadSources.apply(this, arguments);
    ankoppeln();
  };

  function ankoppeln() {
    if (!Array.isArray(windows) || !Array.isArray(sources)) return;
    windows.forEach(w => {
      if (!w.entkoppelt) return;
      const treffer = sources.find(s => s.sourceName === w.title);
      if (!treffer) return;
      w.sourceData = treffer;
      w.entkoppelt = false;
      w.element.classList.remove("entkoppelt");
      kennzeichnen(w, null);
      /* ab jetzt hat OBS die Hoheit über Lage und Größe */
    });
  }

  /* Fenster öffnen sichert auch gleich die Ausgangslage */
  const _createWindowFromSource = window.createWindowFromSource;
  window.createWindowFromSource = async function (source) {
    await _createWindowFromSource.apply(this, arguments);
    const w = windows[windows.length - 1];
    if (w) merke(w);
  };


  /* ================================================================
     4. Apps im Startmenü — erste Anwendung: Neo HUD Progress Bar
        https://ludgar.github.io/fullscreen-progress-bar/
        Die Leiste steuert das HUD über seine URL-Parameter und kann die
        fertige Adresse direkt in eine Browserquelle in OBS schreiben.
  ================================================================ */

  const HUD_STANDARD = "https://ludgar.github.io/fullscreen-progress-bar/";
  const THEMEN = ["cyan", "magenta", "amber", "lime", "violet"];

  if (!daten.hud) daten.hud = {
    basis: HUD_STANDARD, modus: "countdown", theme: "cyan",
    start: "", ende: "", dauer: 600, fortschritt: 50, chaotisch: false, ziel: ""
  };

  let appPanel = null;

  function zeitFeldWert(datum) {
    const z = n => String(n).padStart(2, "0");
    return datum.getFullYear() + "-" + z(datum.getMonth()+1) + "-" + z(datum.getDate())
         + "T" + z(datum.getHours()) + ":" + z(datum.getMinutes());
  }

  function hudURL() {
    const h = daten.hud;
    let basis = (h.basis || HUD_STANDARD).split("?")[0];
    const p = new URLSearchParams();
    p.set("theme", h.theme);
    p.set("mode", h.modus);
    if (h.modus === "countdown") {
      if (h.start) p.set("start", h.start);
      if (h.ende)  p.set("end", h.ende);
    } else if (h.modus === "duration") {
      if (h.dauer > 0) p.set("duration", String(h.dauer));
    } else {
      p.set("progress", String(Math.round(h.fortschritt)));
      if (h.chaotisch) p.set("chaotic", "1");
    }
    return basis + "?" + p.toString();
  }

  /* --- Bausteine für das Panel --- */

  function feld(beschriftung, element) {
    const g = document.createElement("div");
    g.className = "input-group";
    const l = document.createElement("label");
    l.textContent = beschriftung;
    g.appendChild(l);
    g.appendChild(element);
    return g;
  }

  function auswahl(werte, wert, beiAenderung) {
    const s = document.createElement("select");
    s.className = "app-select";
    werte.forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = t;
      s.appendChild(o);
    });
    s.value = wert;
    s.addEventListener("change", () => beiAenderung(s.value));
    return s;
  }

  function knopf(text, klasse, tun) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = klasse;
    b.textContent = text;
    b.addEventListener("click", tun);
    return b;
  }

  /* --- Browserquellen aus OBS holen --- */

  let browserQuellen = [];

  async function quellenHolen() {
    browserQuellen = [];
    if (!obs || !connected) return;
    try {
      const antwort = await obs.call("GetInputList", { inputKind: "browser_source" });
      browserQuellen = (antwort.inputs || []).map(i => i.inputName);
    } catch (e) {
      console.warn("Browserquellen nicht abrufbar:", e);
    }
  }

  async function anQuelleSenden(melde) {
    const h = daten.hud;
    if (!obs || !connected) { melde("Keine Verbindung zu OBS.", true); return; }
    if (!h.ziel) { melde("Keine Zielquelle gewählt.", true); return; }
    try {
      await obs.call("SetInputSettings", {
        inputName: h.ziel,
        inputSettings: { url: hudURL() }
      });
      try {
        await obs.call("PressInputPropertiesButton", {
          inputName: h.ziel, propertyName: "refreshnocache"
        });
      } catch (e) { /* ältere OBS-Versionen kennen den Knopf nicht */ }
      melde("An „" + h.ziel + "“ gesendet.", false);
    } catch (e) {
      melde("Fehlgeschlagen: " + e.message, true);
    }
  }

  function vorschauFenster() {
    const breite = 960, hoehe = 300;
    createFakeWindow("Progress Bar", breite, hoehe, null, 120, 120);
    const w = windows[windows.length - 1];
    if (!w) return;
    w.entkoppelt = true;
    w.element.classList.add("entkoppelt", "app-fenster");
    const inhalt = w.element.querySelector(".window-content");
    if (inhalt) {
      inhalt.innerHTML = "";
      const rahmen = document.createElement("iframe");
      rahmen.src = hudURL();
      rahmen.className = "app-rahmen";
      rahmen.setAttribute("scrolling", "no");
      inhalt.appendChild(rahmen);
    }
  }

  /* --- Das Panel --- */

  function appPanelBauen() {
    const menu = document.getElementById("start-menu");
    if (!menu || document.getElementById("app-panel")) return;

    appPanel = document.createElement("div");
    appPanel.id = "app-panel";

    const kopf = document.createElement("div");
    kopf.id = "app-header";
    const titel = document.createElement("h3");
    titel.textContent = "Progress Bar";
    kopf.appendChild(titel);
    kopf.appendChild(knopf("← Zurück", "app-zurueck", () => appPanel.classList.remove("offen")));
    appPanel.appendChild(kopf);

    const koerper = document.createElement("div");
    koerper.id = "app-body";
    appPanel.appendChild(koerper);

    menu.appendChild(appPanel);
    appPanelFuellen(koerper);
  }

  function appPanelFuellen(koerper) {
    const h = daten.hud;
    koerper.innerHTML = "";

    const meldung = document.createElement("div");
    meldung.className = "app-meldung";
    const melde = (text, schlecht) => {
      meldung.textContent = text;
      meldung.classList.toggle("schlecht", !!schlecht);
      clearTimeout(melde._t);
      melde._t = setTimeout(() => { meldung.textContent = ""; }, 4000);
    };

    const neuzeichnen = () => { sichern(); appPanelFuellen(koerper); };

    /* Modus und Theme */
    const reihe = document.createElement("div");
    reihe.className = "app-reihe";
    reihe.appendChild(feld("Modus", auswahl(
      [["countdown","Countdown"],["duration","Dauer"],["manual","Manuell"]],
      h.modus, v => { h.modus = v; neuzeichnen(); })));
    reihe.appendChild(feld("Farbe", auswahl(
      THEMEN.map(t => [t, t]), h.theme, v => { h.theme = v; neuzeichnen(); })));
    koerper.appendChild(reihe);

    /* Modusabhängige Felder */
    if (h.modus === "countdown") {
      const von = document.createElement("input");
      von.type = "datetime-local"; von.value = h.start;
      von.addEventListener("change", () => { h.start = von.value; sichern(); urlZeigen(); });
      koerper.appendChild(feld("Start", von));

      const bis = document.createElement("input");
      bis.type = "datetime-local"; bis.value = h.ende;
      bis.addEventListener("change", () => { h.ende = bis.value; sichern(); urlZeigen(); });
      koerper.appendChild(feld("Ende", bis));

      const schnell = document.createElement("div");
      schnell.className = "app-schnell";
      schnell.appendChild(knopf("Start = jetzt", "btn-footer", () => {
        h.start = zeitFeldWert(new Date()); neuzeichnen();
      }));
      [15, 30, 60].forEach(min => {
        schnell.appendChild(knopf("+" + min + " Min", "btn-footer", () => {
          const jetzt = new Date();
          h.start = zeitFeldWert(jetzt);
          h.ende  = zeitFeldWert(new Date(jetzt.getTime() + min*60000));
          neuzeichnen();
        }));
      });
      koerper.appendChild(schnell);

    } else if (h.modus === "duration") {
      const dauer = document.createElement("input");
      dauer.type = "number"; dauer.min = "1"; dauer.value = h.dauer;
      dauer.addEventListener("input", () => { h.dauer = parseFloat(dauer.value) || 0; sichern(); urlZeigen(); });
      koerper.appendChild(feld("Dauer in Sekunden", dauer));

      const schnell = document.createElement("div");
      schnell.className = "app-schnell";
      [[300,"5 Min"],[600,"10 Min"],[900,"15 Min"],[1800,"30 Min"]].forEach(([s,t]) => {
        schnell.appendChild(knopf(t, "btn-footer", () => { h.dauer = s; neuzeichnen(); }));
      });
      koerper.appendChild(schnell);

    } else {
      const regler = document.createElement("input");
      regler.type = "range"; regler.min = "0"; regler.max = "100"; regler.value = h.fortschritt;
      regler.className = "app-regler";
      const wert = document.createElement("span");
      wert.className = "app-wert";
      wert.textContent = h.fortschritt + " %";
      regler.addEventListener("input", () => {
        h.fortschritt = parseInt(regler.value, 10);
        wert.textContent = h.fortschritt + " %";
        sichern(); urlZeigen();
      });
      const huelle = document.createElement("div");
      huelle.className = "app-regler-zeile";
      huelle.appendChild(regler); huelle.appendChild(wert);
      koerper.appendChild(feld("Fortschritt", huelle));

      koerper.appendChild(schalter("hud-chaotisch", "Chaotische Sprünge", h.chaotisch,
        v => { h.chaotisch = v; sichern(); urlZeigen(); }));
    }

    /* Zielquelle */
    const zielZeile = document.createElement("div");
    zielZeile.className = "app-reihe";
    const zielWahl = auswahl(
      [["", browserQuellen.length ? "– wählen –" : "keine Browserquelle gefunden"]]
        .concat(browserQuellen.map(n => [n, n])),
      h.ziel, v => { h.ziel = v; sichern(); });
    zielZeile.appendChild(feld("Browserquelle in OBS", zielWahl));
    const neuLaden = knopf("Neu laden", "btn-footer", async () => {
      await quellenHolen();
      neuzeichnen();
      melde(browserQuellen.length + " Browserquelle(n) gefunden.", false);
    });
    neuLaden.classList.add("app-neuladen");
    zielZeile.appendChild(neuLaden);
    koerper.appendChild(zielZeile);

    /* Adresse */
    const adresse = document.createElement("input");
    adresse.type = "text";
    adresse.readOnly = true;
    adresse.className = "app-url";
    koerper.appendChild(feld("Adresse", adresse));
    function urlZeigen() { adresse.value = hudURL(); }
    urlZeigen();

    /* Aktionen */
    const aktionen = document.createElement("div");
    aktionen.className = "button-group";
    aktionen.appendChild(knopf("An Quelle senden", "btn-primary", () => anQuelleSenden(melde)));
    aktionen.appendChild(knopf("Kopieren", "btn-secondary", async () => {
      try { await navigator.clipboard.writeText(hudURL()); melde("Adresse kopiert.", false); }
      catch (e) { adresse.select(); melde("Markieren und mit Strg+C kopieren.", false); }
    }));
    koerper.appendChild(aktionen);

    const zweite = document.createElement("div");
    zweite.className = "button-group";
    zweite.appendChild(knopf("Vorschau als Fenster", "btn-footer", () => {
      vorschauFenster(); closeStartMenu();
    }));
    zweite.appendChild(knopf("Basis-URL ändern", "btn-footer", () => {
      const eingabe = prompt("Adresse der Progress Bar", h.basis || HUD_STANDARD);
      if (eingabe) { h.basis = eingabe.trim(); neuzeichnen(); }
    }));
    koerper.appendChild(zweite);

    koerper.appendChild(meldung);
  }

  /* Startleiste mit den Apps oben im Quellen-Panel */
  function appLeisteBauen() {
    const ziel = document.getElementById("sources-panel");
    if (!ziel || document.getElementById("app-leiste")) return;

    const leiste = document.createElement("div");
    leiste.id = "app-leiste";

    const rubrik = document.createElement("div");
    rubrik.className = "quellen-rubrik";
    rubrik.style.borderTop = "0";
    rubrik.textContent = "Apps";
    leiste.appendChild(rubrik);

    const knoepfe = document.createElement("div");
    knoepfe.className = "app-kacheln";
    knoepfe.appendChild(knopf("⏱  Progress Bar", "app-kachel", async () => {
      await quellenHolen();
      appPanelBauen();
      const koerper = document.getElementById("app-body");
      if (koerper) appPanelFuellen(koerper);
      appPanel.classList.add("offen");
    }));
    leiste.appendChild(knoepfe);

    ziel.insertBefore(leiste, ziel.firstChild);
  }

  /* ================================================================
     Start
  ================================================================ */

  function start() {
    baueEinstellungen();
    appLeisteBauen();
    felderFuellen();
    automatischVerbinden();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  /* für die Konsole, falls du mal aufräumen willst */
  window.taskbarSpeicher = {
    lesen:  () => daten,
    leeren: () => { daten = Object.assign({}, leer); sichern(); },
    vergessen: name => { delete daten.geometrie[name]; sichern(); }
  };
})();
