// Ansicht für Lernende: Namen wählen, Module bearbeiten, Auswertung ansehen.
import {
  auth, db, isConfigured, onAuthStateChanged, signInAnonymously,
  doc, collection, getDoc, getDocs, setDoc, addDoc, updateDoc, query, where, serverTimestamp,
} from "./firebase.js";
import {
  esc, escMultiline, fmtDate, fmtPoints, letter, safeUrl, statusOf, statusBadge,
  isAnswered, countAnswered, computeScore, mcResult, RATING, toast, errorText,
} from "./common.js";

const LS_USER = "produktwissen.userId";
const PAGE_SIZE = 5;
const TEXT_SAVE_DELAY = 800;
const RETRY_DELAY = 5000;

const appEl = document.getElementById("app");
const whoEl = document.getElementById("who");
const bottombar = document.getElementById("bottombar");
const saveStateEl = document.getElementById("saveState");
const submitBtn = document.getElementById("submitBtn");

const state = {
  uid: null,          // Firebase-Auth-UID (anonym)
  user: null,         // { id, name } – gewählter Lernender
  modules: [],
  attempts: {},       // moduleId → attempt
  view: null,         // { module, attempt, ref, page } im Bearbeitungsmodus
};

// ---------- Hilfen ----------

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* privat */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* privat */ } };

const attemptId = (userId, moduleId) => `${userId}_${moduleId}`;
const byOrder = (a, b) => (a.order ?? 9999) - (b.order ?? 9999) || String(a.title).localeCompare(String(b.title), "de-CH");

function setMain(html) {
  appEl.innerHTML = html;
}

function showLoading(text = "Lädt …") {
  setMain(`<div class="loading"><div class="spinner"></div>${esc(text)}</div>`);
}

function showError(message, backLink = true) {
  setMain(`
    <div class="card center-card">
      <div class="notice error">${esc(message)}</div>
      <div class="row">
        <button type="button" onclick="location.reload()">Neu laden</button>
        ${backLink ? `<a class="btn" href="#/">Zur Übersicht</a>` : ""}
      </div>
    </div>`);
}

function renderWho() {
  if (!state.user) {
    whoEl.innerHTML = "";
    return;
  }
  whoEl.innerHTML = `<span class="long">Hallo </span><strong>${esc(state.user.name)}</strong> ·
    <button type="button" class="btn-link" id="notYouBtn">Nicht du?</button>`;
  document.getElementById("notYouBtn").addEventListener("click", switchUser);
}

// ---------- Start & Anmeldung im Hintergrund ----------

if (!isConfigured) {
  showError("Die App ist noch nicht eingerichtet: Bitte js/firebase-config.js ausfüllen (siehe README).", false);
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        showError(`Verbindung fehlgeschlagen: ${errorText(err)}`, false);
      }
      return;
    }
    if (state.uid === user.uid) return;
    state.uid = user.uid;
    try {
      await start();
    } catch (err) {
      console.error(err);
      showError(`Fehler beim Laden: ${errorText(err)}`, false);
    }
  });
}

async function start() {
  showLoading();
  const stored = lsGet(LS_USER);
  if (stored) {
    const snap = await getDoc(doc(db, "users", stored));
    if (snap.exists()) {
      await activateUser(snap.id, snap.data().name);
      return;
    }
    lsDel(LS_USER);
  }
  await showPicker();
}

async function activateUser(id, name) {
  // Verknüpft die anonyme Anmeldung mit dem gewählten Lernenden (für die Firestore-Regeln).
  await setDoc(doc(db, "sessions", state.uid), { userId: id, updatedAt: serverTimestamp() });
  state.user = { id, name };
  lsSet(LS_USER, id);
  renderWho();
  route();
}

async function switchUser() {
  await leaveModule();
  state.user = null;
  state.view = null;
  lsDel(LS_USER);
  renderWho();
  if (location.hash && location.hash !== "#/") history.replaceState(null, "", "#/");
  await showPicker();
}

async function showPicker() {
  hideBottombar();
  showLoading();
  let users;
  try {
    const snap = await getDocs(collection(db, "users"));
    users = snap.docs
      .map((d) => ({ id: d.id, name: d.data().name || "?" }))
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH"));
  } catch (err) {
    showError(`Namensliste konnte nicht geladen werden: ${errorText(err)}`, false);
    return;
  }

  setMain(`
    <div class="card center-card">
      <h1>Wer bist du?</h1>
      ${users.length
        ? `<p class="muted">Tippe deinen Namen an.</p>
           <div class="name-list">${users.map((u) => `<button type="button" data-id="${esc(u.id)}">${esc(u.name)}</button>`).join("")}</div>
           <div class="divider">oder</div>`
        : `<p class="muted">Es ist noch niemand registriert.</p>`}
      <form id="registerForm" autocomplete="off">
        <label class="field" for="newName">Neu registrieren</label>
        <div class="row">
          <input id="newName" type="text" maxlength="60" placeholder="Vorname Nachname" required style="flex:1;min-width:180px">
          <button class="btn-primary" type="submit">Registrieren</button>
        </div>
        <p class="small muted" style="margin-top:8px">Nur dein Name wird gespeichert, kein Passwort.</p>
      </form>
    </div>`);

  appEl.querySelectorAll(".name-list button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const u = users.find((x) => x.id === btn.dataset.id);
      try {
        await activateUser(u.id, u.name);
      } catch (err) {
        btn.disabled = false;
        toast(errorText(err), "error");
      }
    });
  });

  document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("newName");
    const name = input.value.replace(/\s+/g, " ").trim();
    if (name.length < 2) {
      toast("Bitte gib deinen Namen ein.", "error");
      return;
    }
    if (users.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
      toast("Diesen Namen gibt es schon – tippe ihn oben an.", "error");
      return;
    }
    const btn = e.submitter || e.target.querySelector("button");
    btn.disabled = true;
    try {
      const ref = await addDoc(collection(db, "users"), { name, createdAt: serverTimestamp() });
      await activateUser(ref.id, name);
    } catch (err) {
      btn.disabled = false;
      toast(`Registrierung fehlgeschlagen: ${errorText(err)}`, "error");
    }
  });
}

// ---------- Routing ----------

window.addEventListener("hashchange", () => {
  if (state.user) route();
});

async function route() {
  await leaveModule();
  const m = /^#\/modul\/([^/]+)$/.exec(location.hash);
  try {
    if (m) await openModule(decodeURIComponent(m[1]));
    else await showHome();
  } catch (err) {
    console.error(err);
    showError(`Fehler beim Laden: ${errorText(err)}`);
  }
  window.scrollTo(0, 0);
}

// ---------- Modulübersicht ----------

async function showHome() {
  hideBottombar();
  document.title = "Produktwissen";
  showLoading("Module werden geladen …");
  const [modSnap, attSnap] = await Promise.all([
    getDocs(query(collection(db, "modules"), where("active", "==", true))),
    getDocs(query(collection(db, "attempts"), where("userId", "==", state.user.id))),
  ]);
  state.modules = modSnap.docs.map((d) => ({ ...d.data(), id: d.id })).sort(byOrder);
  state.attempts = {};
  attSnap.forEach((d) => {
    const a = d.data();
    state.attempts[a.moduleId] = a;
  });

  if (!state.modules.length) {
    setMain(`<div class="card"><h1>Deine Module</h1><p class="muted">Es sind noch keine Module freigeschaltet.</p></div>`);
    return;
  }

  const finished = state.modules.filter((m) => ["submitted", "reviewed"].includes(statusOf(state.attempts[m.id]))).length;
  const cards = state.modules.map((m) => {
    const a = state.attempts[m.id];
    const status = statusOf(a);
    const total = m.questions?.length || m.questionCount || 0;
    const answered = a ? countAnswered(m.questions || [], a.answers) : 0;
    const pct = total ? Math.round((answered / total) * 100) : 0;
    const buttonText = { open: "Starten", in_progress: "Weiterarbeiten", submitted: "Auswertung ansehen", reviewed: "Korrektur ansehen" }[status];
    let extra = "";
    if (status === "reviewed" && typeof a.score === "number") {
      extra = `<strong>${fmtPoints(a.score)} von ${fmtPoints(a.maxScore ?? total)} Punkten</strong>`;
    } else if (status === "submitted") {
      extra = "Eingereicht – wird korrigiert";
    } else {
      extra = `${answered} von ${total} beantwortet`;
    }
    return `
      <div class="card module-card">
        <div class="head">
          <div>
            <h2>${esc(m.title)}</h2>
            ${m.productArea ? `<span class="tag">${esc(m.productArea)}</span>` : ""}
          </div>
          ${statusBadge(status)}
        </div>
        ${m.description ? `<p class="muted" style="margin:0">${esc(m.description)}</p>` : ""}
        <div class="progress ${status === "reviewed" || status === "submitted" ? "done" : ""}"><span style="width:${status === "open" ? 0 : status === "in_progress" ? pct : 100}%"></span></div>
        <div class="row between">
          <span class="meta">${extra}</span>
          <a class="btn ${status === "submitted" ? "" : "btn-primary"}" href="#/modul/${encodeURIComponent(m.id)}">${buttonText}</a>
        </div>
      </div>`;
  }).join("");

  setMain(`
    <div class="row between" style="margin-bottom:12px">
      <h1 style="margin:0">Deine Module</h1>
      <span class="muted small">${finished} von ${state.modules.length} eingereicht</span>
    </div>
    ${cards}`);
}

// ---------- Modul öffnen ----------

async function openModule(moduleId) {
  hideBottombar();
  showLoading("Modul wird geladen …");
  const ref = doc(db, "attempts", attemptId(state.user.id, moduleId));
  const [mSnap, aSnap] = await Promise.all([getDoc(doc(db, "modules", moduleId)), getDoc(ref)]);
  if (!mSnap.exists()) {
    showError("Dieses Modul gibt es nicht (mehr).");
    return;
  }
  const module = { ...mSnap.data(), id: mSnap.id };
  const attempt = aSnap.exists() ? aSnap.data() : null;
  document.title = `${module.title} – Produktwissen`;

  if (!attempt) {
    if (!module.active) {
      showError("Dieses Modul ist zurzeit nicht freigeschaltet.");
      return;
    }
    renderIntro(module, ref);
  } else if (attempt.status === "in_progress") {
    attempt.answers ||= {};
    const firstOpen = module.questions.findIndex((q) => !isAnswered(q, attempt.answers[q.id]));
    const page = firstOpen < 0 ? Math.floor((module.questions.length - 1) / PAGE_SIZE) : Math.floor(firstOpen / PAGE_SIZE);
    state.view = { module, attempt, ref, page };
    renderEditor();
  } else {
    let solutions = null;
    try {
      const sSnap = await getDoc(doc(db, "moduleSolutions", moduleId));
      if (sSnap.exists()) solutions = sSnap.data().questions || {};
    } catch (err) {
      console.warn("Lösungen nicht lesbar", err);
    }
    renderResult(module, attempt, solutions);
  }
}

function renderIntro(module, ref) {
  const qs = module.questions || [];
  const mc = qs.filter((q) => q.type === "mc").length;
  const source = safeUrl(module.sourceUrl);
  setMain(`
    <a href="#/" class="btn-link">← Alle Module</a>
    <div class="card" style="margin-top:12px">
      <h1>${esc(module.title)}</h1>
      ${module.productArea ? `<p><span class="tag">${esc(module.productArea)}</span></p>` : ""}
      ${module.description ? `<p>${esc(module.description)}</p>` : ""}
      <p class="muted">${qs.length} Fragen · ${mc} Multiple Choice · ${qs.length - mc} offene Fragen</p>
      ${source ? `<p><a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Zum Sortiment auf veloplus.ch ↗</a></p>` : ""}
      <div class="notice info">
        Die Antworten findest du auf veloplus.ch. Alles wird automatisch gespeichert –
        du kannst jederzeit unterbrechen und später weitermachen. Wenn du fertig bist, reichst du das Modul ein.
      </div>
      <button class="btn-primary" type="button" id="startBtn">Modul starten</button>
    </div>`);
  document.getElementById("startBtn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await setDoc(ref, {
        userId: state.user.id,
        moduleId: module.id,
        status: "in_progress",
        answers: {},
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      state.view = { module, attempt: { status: "in_progress", answers: {} }, ref, page: 0 };
      renderEditor();
      window.scrollTo(0, 0);
    } catch (err) {
      e.target.disabled = false;
      toast(`Start fehlgeschlagen: ${errorText(err)}`, "error");
    }
  });
}

// ---------- Bearbeiten ----------

function questionEditor(q, index) {
  const a = state.view.attempt.answers[q.id];
  const hint = safeUrl(q.hintUrl);
  let body;
  if (q.type === "mc") {
    const type = q.multiple ? "checkbox" : "radio";
    const chosen = Array.isArray(a?.value) ? a.value : [];
    body = `
      ${q.multiple ? `<p class="multi-note">Mehrere Antworten möglich.</p>` : ""}
      <div class="options">
        ${q.options.map((opt, i) => `
          <label class="option">
            <input type="${type}" name="q-${esc(q.id)}" value="${i}" ${chosen.includes(i) ? "checked" : ""}>
            <span class="opt-letter">${letter(i)}</span><span>${esc(opt)}</span>
          </label>`).join("")}
      </div>`;
  } else {
    body = `<textarea aria-label="Antwort auf Frage ${index + 1}" placeholder="Deine Antwort …" maxlength="5000">${esc(a?.value ?? "")}</textarea>`;
  }
  return `
    <div class="card question" data-qid="${esc(q.id)}">
      <div class="qnum">Frage ${index + 1} von ${state.view.module.questions.length}</div>
      <div class="qtext">${esc(q.text)}</div>
      ${body}
      ${hint ? `<a class="hint" href="${esc(hint)}" target="_blank" rel="noopener noreferrer">💡 Hinweis: Produktseite öffnen ↗</a>` : ""}
    </div>`;
}

function renderEditor() {
  const { module, page } = state.view;
  const qs = module.questions;
  const pages = Math.max(1, Math.ceil(qs.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const pageQs = qs.slice(start, start + PAGE_SIZE);

  const dots = Array.from({ length: pages }, (_, p) =>
    `<button type="button" data-page="${p}" class="${p === page ? "current" : ""}" aria-label="Seite ${p + 1}">${p + 1}</button>`).join("");

  setMain(`
    <a href="#/" class="btn-link">← Alle Module</a>
    <h1 style="margin-top:12px">${esc(module.title)}</h1>
    <div class="card">
      <div class="row between small" style="margin-bottom:6px">
        <span>Fortschritt</span><span id="progText"></span>
      </div>
      <div class="progress"><span id="progBar"></span></div>
    </div>
    ${pageQs.map((q, i) => questionEditor(q, start + i)).join("")}
    <div class="card pager">
      <button type="button" data-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← Zurück</button>
      <div class="page-dots">${dots}</div>
      ${page < pages - 1
        ? `<button type="button" class="btn-primary" data-page="${page + 1}">Weiter →</button>`
        : `<button type="button" class="btn-primary" data-action="submit">Modul einreichen</button>`}
    </div>`);

  appEl.querySelectorAll("[data-page]").forEach((b) =>
    b.addEventListener("click", () => goPage(Number(b.dataset.page))));
  appEl.querySelector('[data-action="submit"]')?.addEventListener("click", submitModule);

  showBottombar();
  updateProgress();
  setSaveState(saver.error ? "error" : saver.queue.size || saver.running ? "pending" : "idle");
}

function goPage(p) {
  flushDebounces();
  const pages = Math.ceil(state.view.module.questions.length / PAGE_SIZE);
  state.view.page = Math.min(Math.max(0, p), pages - 1);
  renderEditor();
  window.scrollTo(0, 0);
}

function updateProgress() {
  if (!state.view) return;
  const { module, attempt } = state.view;
  const total = module.questions.length;
  const answered = countAnswered(module.questions, attempt.answers);
  const progText = document.getElementById("progText");
  const progBar = document.getElementById("progBar");
  if (progText) progText.textContent = `${answered} von ${total} beantwortet`;
  if (progBar) progBar.style.width = `${total ? (answered / total) * 100 : 0}%`;
  appEl.querySelectorAll(".page-dots button").forEach((b) => {
    const p = Number(b.dataset.page);
    const slice = module.questions.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
    b.classList.toggle("complete", slice.every((q) => isAnswered(q, attempt.answers[q.id])));
  });
}

// Eingaben
appEl.addEventListener("change", (e) => {
  const input = e.target;
  if (!state.view || input.tagName !== "INPUT") return;
  const card = input.closest(".question");
  if (!card) return;
  const qid = card.dataset.qid;
  const value = [...card.querySelectorAll("input:checked")].map((i) => Number(i.value)).sort((a, b) => a - b);
  setLocalAnswer(qid, value);
  queueSave(qid, value);
});

appEl.addEventListener("input", (e) => {
  if (!state.view || e.target.tagName !== "TEXTAREA") return;
  const qid = e.target.closest(".question")?.dataset.qid;
  if (!qid) return;
  const value = e.target.value;
  setLocalAnswer(qid, value);
  const existing = saver.timers.get(qid);
  if (existing) clearTimeout(existing.timer);
  saver.timers.set(qid, {
    value,
    timer: setTimeout(() => {
      saver.timers.delete(qid);
      queueSave(qid, value);
    }, TEXT_SAVE_DELAY),
  });
  setSaveState("pending");
});

appEl.addEventListener("focusout", (e) => {
  if (e.target.tagName === "TEXTAREA") flushDebounces();
});

function setLocalAnswer(qid, value) {
  state.view.attempt.answers[qid] = { value };
  updateProgress();
}

// ---------- Automatisches Speichern ----------
// Pro Schreibvorgang wird genau eine Antwort gespeichert (so prüfen es die Firestore-Regeln).

const saver = {
  queue: new Map(),   // qid → { ref, value }
  timers: new Map(),  // qid → { timer, value } (Verzögerung beim Tippen)
  running: null,
  retryTimer: null,
  error: false,
  fatal: false,
};

function queueSave(qid, value) {
  if (!state.view) return;
  saver.queue.set(qid, { ref: state.view.ref, value });
  setSaveState("pending");
  runSaver();
}

function flushDebounces() {
  for (const [qid, t] of saver.timers) {
    clearTimeout(t.timer);
    queueSave(qid, t.value);
  }
  saver.timers.clear();
}

function runSaver() {
  if (!saver.running) {
    saver.running = processQueue().finally(() => {
      saver.running = null;
    });
  }
  return saver.running;
}

async function processQueue() {
  clearTimeout(saver.retryTimer);
  while (saver.queue.size) {
    const [qid, item] = saver.queue.entries().next().value;
    saver.queue.delete(qid);
    try {
      await updateDoc(item.ref, {
        [`answers.${qid}`]: { value: item.value },
        lastSaved: qid,
        updatedAt: serverTimestamp(),
      });
      saver.error = false;
    } catch (err) {
      console.error("Speichern fehlgeschlagen", err);
      if (!saver.queue.has(qid)) saver.queue.set(qid, item);
      saver.error = true;
      const code = err?.code || "";
      saver.fatal = code.includes("permission-denied") || code.includes("not-found");
      setSaveState("error");
      if (!saver.fatal) saver.retryTimer = setTimeout(runSaver, RETRY_DELAY);
      return;
    }
  }
  setSaveState("saved");
}

async function waitForSaves() {
  flushDebounces();
  if (saver.queue.size) await runSaver();
  else if (saver.running) await saver.running;
  return saver.queue.size === 0 && !saver.error;
}

/** Vor dem Verlassen eines Moduls: offene Eingaben speichern. */
async function leaveModule() {
  if (!state.view) return;
  await waitForSaves();
  state.view = null;
}

function setSaveState(kind) {
  const texts = {
    idle: "Antworten werden automatisch gespeichert.",
    pending: "Speichert …",
    saved: "✓ Alle Antworten gespeichert",
    error: saver.fatal
      ? "⚠ Speichern nicht möglich – wurde das Modul zurückgesetzt? Bitte Seite neu laden."
      : "⚠ Speichern fehlgeschlagen – neuer Versuch läuft …",
  };
  saveStateEl.textContent = texts[kind] || "";
  saveStateEl.classList.toggle("error", kind === "error");
}

window.addEventListener("beforeunload", (e) => {
  if (saver.queue.size || saver.timers.size || saver.running) {
    flushDebounces();
    e.preventDefault();
    e.returnValue = "";
  }
});

// Auf dem Handy: Beim Wechsel zu veloplus.ch sofort speichern.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushDebounces();
});

// ---------- Einreichen ----------

submitBtn.addEventListener("click", submitModule);

async function submitModule() {
  if (!state.view) return;
  const { module, attempt, ref } = state.view;
  const ok = await waitForSaves();
  if (!ok) {
    toast("Es konnten nicht alle Antworten gespeichert werden. Bitte Verbindung prüfen.", "error");
    return;
  }
  const open = module.questions.length - countAnswered(module.questions, attempt.answers);
  const question = open
    ? `Du hast ${open} ${open === 1 ? "Frage" : "Fragen"} noch nicht beantwortet. Trotzdem einreichen?`
    : "Alle Fragen beantwortet. Modul jetzt einreichen?";
  if (!confirm(`${question}\n\nDanach kannst du die Antworten nicht mehr ändern.`)) return;

  submitBtn.disabled = true;
  try {
    await updateDoc(ref, { status: "submitted", submittedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    toast("Modul eingereicht – gut gemacht!", "ok");
    state.view = null;
    await openModule(module.id);
    window.scrollTo(0, 0);
  } catch (err) {
    toast(`Einreichen fehlgeschlagen: ${errorText(err)}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
}

function showBottombar() {
  bottombar.classList.remove("hidden");
}

function hideBottombar() {
  bottombar.classList.add("hidden");
}

// ---------- Auswertung (schreibgeschützt) ----------

function renderResult(module, attempt, solutions) {
  const qs = module.questions;
  const answers = attempt.answers || {};
  const sum = computeScore(qs, answers, solutions || {});
  const reviewed = attempt.status === "reviewed";
  const mcKnown = !!solutions || reviewed;

  const stats = [];
  if (reviewed) {
    stats.push(`<div class="stat"><div class="num">${fmtPoints(attempt.score ?? sum.score)} / ${fmtPoints(attempt.maxScore ?? sum.maxScore)}</div><div class="lbl">Punkte total</div></div>`);
  }
  if (sum.mcTotal) {
    stats.push(`<div class="stat"><div class="num">${mcKnown ? `${sum.mcCorrect} / ${sum.mcTotal}` : "–"}</div><div class="lbl">Multiple Choice richtig</div></div>`);
  }
  if (sum.openTotal) {
    stats.push(`<div class="stat"><div class="num">${reviewed ? `${fmtPoints(sum.openPoints)} / ${sum.openTotal}` : "…"}</div><div class="lbl">Offene Fragen${reviewed ? " (Punkte)" : " – wird korrigiert"}</div></div>`);
  }

  const items = qs.map((q, i) => {
    const a = answers[q.id];
    let body = "";
    let pill = "";
    if (q.type === "mc") {
      const chosen = Array.isArray(a?.value) ? a.value : [];
      const sol = solutions?.[q.id];
      const result = mcResult(q, a, solutions || {});
      if (result !== null) {
        pill = result ? `<span class="badge r-correct result-pill">✓ Richtig</span>` : `<span class="badge r-wrong result-pill">✗ Falsch</span>`;
      }
      body = `<div class="options">${q.options.map((opt, oi) => {
        const isChosen = chosen.includes(oi);
        const isRight = sol ? sol.correct.includes(oi) : null;
        let cls = "";
        let mark = "";
        if (isRight === true) {
          cls = "is-correct";
          mark = isChosen ? "✓ deine Wahl" : "richtige Antwort";
        } else if (isChosen) {
          cls = isRight === false ? "is-wrong" : "";
          mark = isRight === false ? "✗ deine Wahl" : "deine Wahl";
        }
        return `<div class="option readonly ${cls}"><span class="opt-letter">${letter(oi)}</span><span>${esc(opt)}</span>${mark ? `<span class="mark">${mark}</span>` : ""}</div>`;
      }).join("")}</div>
      ${!chosen.length ? `<p class="small muted" style="margin-top:8px">Nicht beantwortet.</p>` : ""}
      ${sol?.explanation ? `<div class="explanation"><strong>Erklärung:</strong> ${escMultiline(sol.explanation)}</div>` : ""}`;
    } else {
      const text = typeof a?.value === "string" ? a.value.trim() : "";
      const review = a?.review;
      if (reviewed && RATING[review?.rating]) {
        const r = RATING[review.rating];
        pill = `<span class="badge ${r.cls} result-pill">${r.label}</span>`;
      } else if (!reviewed && text) {
        pill = `<span class="badge st-submitted result-pill">Wird korrigiert</span>`;
      }
      body = `<div class="answer-box ${text ? "" : "empty"}">${text ? esc(text) : "Nicht beantwortet."}</div>
        ${reviewed && review?.comment ? `<div class="comment"><strong>Kommentar:</strong> ${escMultiline(review.comment)}</div>` : ""}`;
    }
    return `
      <div class="card question">
        ${pill}
        <div class="qnum">Frage ${i + 1}</div>
        <div class="qtext">${esc(q.text)}</div>
        ${body}
      </div>`;
  }).join("");

  setMain(`
    <a href="#/" class="btn-link">← Alle Module</a>
    <h1 style="margin-top:12px">${esc(module.title)}</h1>
    <div class="card">
      <div class="row between" style="margin-bottom:12px">
        ${statusBadge(attempt.status)}
        <span class="small muted">Eingereicht am ${fmtDate(attempt.submittedAt)}${reviewed ? ` · korrigiert am ${fmtDate(attempt.reviewedAt)}` : ""}</span>
      </div>
      ${!reviewed ? `<div class="notice info">Deine offenen Antworten werden noch korrigiert. Danach siehst du hier die Bewertung und Kommentare.</div>` : ""}
      ${!mcKnown && sum.mcTotal ? `<div class="notice warn">Die Multiple-Choice-Auswertung konnte nicht geladen werden.</div>` : ""}
      <div class="summary-grid">${stats.join("")}</div>
    </div>
    ${items}
    <a href="#/" class="btn">← Zurück zur Übersicht</a>`);
}
