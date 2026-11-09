// Admin-Bereich: Übersicht, Korrektur, Zurücksetzen, Modulverwaltung und Import.
import {
  auth, db, isConfigured, isAdminUser, ADMIN_EMAIL,
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut,
  doc, collection, getDoc, getDocs, updateDoc, writeBatch, serverTimestamp,
} from "./firebase.js";
import {
  esc, escMultiline, fmtDate, fmtPoints, letter, safeUrl, statusOf, statusBadge,
  countAnswered, computeScore, mcResult, RATING, toast, errorText, toDate,
} from "./common.js";
import { parseModulesInput, validateImport, splitModule } from "./module-schema.js";

const appEl = document.getElementById("app");
const whoEl = document.getElementById("who");
const tabsEl = document.getElementById("tabs");
const reviewBar = document.getElementById("reviewBar");
const reviewSummary = document.getElementById("reviewSummary");
const finalizeBtn = document.getElementById("finalizeBtn");

const state = {
  user: null,
  users: [],
  modules: [],
  attempts: [],
  history: [],
  review: null,       // aktuell geöffnete Korrektur
  importDraft: null,  // geprüfter Import
};

const byOrder = (a, b) => (a.order ?? 9999) - (b.order ?? 9999) || String(a.title).localeCompare(String(b.title), "de-CH");
const byName = (a, b) => String(a.name).localeCompare(String(b.name), "de-CH");
const time = (ts) => toDate(ts)?.getTime() ?? 0;

function setMain(html) {
  appEl.innerHTML = html;
}

function showLoading(text = "Lädt …") {
  setMain(`<div class="loading"><div class="spinner"></div>${esc(text)}</div>`);
}

function showError(message) {
  setMain(`<div class="card"><div class="notice error">${esc(message)}</div>
    <button type="button" onclick="location.reload()">Neu laden</button></div>`);
}

// ---------- Anmeldung ----------

if (!isConfigured) {
  showError("Die App ist noch nicht eingerichtet: Bitte js/firebase-config.js ausfüllen (siehe README).");
} else {
  getRedirectResult(auth).catch((err) => toast(`Anmeldung fehlgeschlagen: ${errorText(err)}`, "error"));
  onAuthStateChanged(auth, async (user) => {
    if (isAdminUser(user)) {
      const first = !state.user;
      state.user = user;
      renderChrome();
      if (first) await route();
    } else {
      state.user = null;
      renderChrome();
      renderLogin(user);
    }
  });
}

function renderChrome() {
  tabsEl.classList.toggle("hidden", !state.user);
  whoEl.innerHTML = state.user
    ? `<span class="long">${esc(state.user.email)} · </span><button type="button" class="btn-link" id="logoutBtn">Abmelden</button>`
    : "";
  document.getElementById("logoutBtn")?.addEventListener("click", () => signOut(auth));
}

function renderLogin(user) {
  hideReviewBar();
  const wrongAccount = user && !user.isAnonymous;
  setMain(`
    <div class="card center-card">
      <h1>Admin-Bereich</h1>
      <p class="muted">Anmeldung mit dem Google-Konto des Admins.</p>
      ${wrongAccount ? `<div class="notice error">Das Konto <strong>${esc(user.email)}</strong> hat keinen Admin-Zugang.</div>` : ""}
      <div class="row">
        <button type="button" class="btn-primary" id="loginBtn">Mit Google anmelden</button>
        ${wrongAccount ? `<button type="button" id="logoutBtn2">Abmelden</button>` : ""}
      </div>
      <p class="small muted" style="margin-top:14px"><a href="./">Zur Lernenden-Ansicht</a></p>
    </div>`);
  document.getElementById("logoutBtn2")?.addEventListener("click", () => signOut(auth));
  document.getElementById("loginBtn").addEventListener("click", async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account", login_hint: ADMIN_EMAIL });
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, provider);
      } else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        toast(`Anmeldung fehlgeschlagen: ${errorText(err)}`, "error");
      }
    }
  });
}

// ---------- Daten & Routing ----------

async function loadAll() {
  const [u, m, a, h] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "modules")),
    getDocs(collection(db, "attempts")),
    getDocs(collection(db, "attemptHistory")),
  ]);
  state.users = u.docs.map((d) => ({ ...d.data(), id: d.id })).sort(byName);
  state.modules = m.docs.map((d) => ({ ...d.data(), id: d.id })).sort(byOrder);
  state.attempts = a.docs.map((d) => ({ ...d.data(), _id: d.id }));
  state.history = h.docs.map((d) => ({ ...d.data(), _id: d.id }));
  const n = state.attempts.filter((x) => x.status === "submitted").length;
  const badge = document.getElementById("submittedCount");
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
}

window.addEventListener("hashchange", () => {
  if (state.user) route();
});

async function route() {
  await leaveReview();
  hideReviewBar();
  const h = location.hash;
  let m;
  let tab = "overview";
  showLoading();
  try {
    if (h === "#/module") {
      tab = "modules";
      await loadAll();
      renderModules();
    } else if (h === "#/import") {
      tab = "import";
      await loadAll();
      renderImport();
    } else if ((m = /^#\/review\/(.+)$/.exec(h))) {
      tab = "";
      await openReview("attempts", decodeURIComponent(m[1]));
    } else if ((m = /^#\/archiv\/(.+)$/.exec(h))) {
      tab = "";
      await openReview("attemptHistory", decodeURIComponent(m[1]));
    } else if ((m = /^#\/verlauf\/([^/]+)\/([^/]+)$/.exec(h))) {
      tab = "";
      await loadAll();
      renderHistory(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    } else {
      await loadAll();
      renderOverview();
    }
  } catch (err) {
    console.error(err);
    showError(`Fehler beim Laden: ${errorText(err)}`);
  }
  tabsEl.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  window.scrollTo(0, 0);
}

// ---------- Übersicht ----------

function attemptFor(userId, moduleId) {
  return state.attempts.find((a) => a.userId === userId && a.moduleId === moduleId) || null;
}

function historyFor(userId, moduleId) {
  return state.history
    .filter((h) => h.userId === userId && h.moduleId === moduleId)
    .sort((a, b) => time(b.archivedAt) - time(a.archivedAt));
}

function moduleTitle(moduleId) {
  return state.modules.find((m) => m.id === moduleId)?.title || moduleId;
}

function userName(userId) {
  return state.users.find((u) => u.id === userId)?.name || "(unbekannt)";
}

function renderOverview() {
  const submitted = state.attempts
    .filter((a) => a.status === "submitted")
    .sort((a, b) => time(a.submittedAt) - time(b.submittedAt));

  const todo = submitted.length
    ? `<table class="list-table"><tbody>${submitted.map((a) => `
        <tr class="highlight">
          <td><strong>${esc(userName(a.userId))}</strong></td>
          <td>${esc(moduleTitle(a.moduleId))}</td>
          <td data-label="Eingereicht">${fmtDate(a.submittedAt)}</td>
          <td><div class="actions"><a class="btn btn-primary btn-small" href="#/review/${encodeURIComponent(a._id)}">Korrigieren</a></div></td>
        </tr>`).join("")}</tbody></table>`
    : `<p class="muted" style="margin:0">Keine eingereichten Module offen.</p>`;

  const userCards = state.users.map((u) => {
    const mods = state.modules.filter((m) => m.active || attemptFor(u.id, m.id) || historyFor(u.id, m.id).length);
    const rows = mods.map((m) => {
      const a = attemptFor(u.id, m.id);
      const status = statusOf(a);
      const total = m.questions?.length || 0;
      const answered = a ? countAnswered(m.questions || [], a.answers) : 0;
      const hist = historyFor(u.id, m.id);
      const date = status === "reviewed" ? `korrigiert ${fmtDate(a.reviewedAt, false)}`
        : status === "submitted" ? `eingereicht ${fmtDate(a.submittedAt, false)}`
        : status === "in_progress" ? `zuletzt ${fmtDate(a.updatedAt, false)}` : "";
      const score = status === "reviewed" && typeof a.score === "number" ? `${fmtPoints(a.score)} / ${fmtPoints(a.maxScore ?? total)}` : "–";
      return `
        <tr class="${status === "submitted" ? "highlight" : ""} ${m.active ? "" : "inactive"}">
          <td><strong>${esc(m.title)}</strong>${m.active ? "" : ` <span class="tag">inaktiv</span>`}</td>
          <td>${statusBadge(status)}</td>
          <td data-label="Beantwortet">${a ? `${answered} / ${total}` : "–"}</td>
          <td data-label="Punkte">${score}</td>
          <td class="small muted">${date}${hist.length ? `<br><a href="#/verlauf/${encodeURIComponent(u.id)}/${encodeURIComponent(m.id)}">${hist.length} ${hist.length === 1 ? "früherer Versuch" : "frühere Versuche"}</a>` : ""}</td>
          <td><div class="actions">
            ${a ? `<a class="btn btn-small ${status === "submitted" ? "btn-primary" : ""}" href="#/review/${encodeURIComponent(a._id)}">${status === "submitted" ? "Korrigieren" : "Ansehen"}</a>
                   <button type="button" class="btn-small btn-danger" data-reset="${esc(a._id)}">Zurücksetzen</button>` : ""}
          </div></td>
        </tr>`;
    }).join("");
    return `
      <div class="card">
        <div class="row between"><h2 style="margin:0">${esc(u.name)}</h2><span class="small muted">registriert ${fmtDate(u.createdAt, false)}</span></div>
        ${mods.length
          ? `<table class="list-table" style="margin-top:8px"><thead><tr><th>Modul</th><th>Status</th><th>Beantwortet</th><th>Punkte</th><th>Datum</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
          : `<p class="muted">Keine aktiven Module.</p>`}
      </div>`;
  }).join("");

  setMain(`
    <div class="card">
      <h2>Zu korrigieren ${submitted.length ? `<span class="badge st-submitted">${submitted.length}</span>` : ""}</h2>
      ${todo}
    </div>
    <h1 style="margin:24px 0 12px">Lernende</h1>
    ${userCards || `<div class="card"><p class="muted" style="margin:0">Noch niemand registriert.</p></div>`}`);

  appEl.querySelectorAll("[data-reset]").forEach((b) =>
    b.addEventListener("click", () => resetAttempt(b.dataset.reset)));
}

function renderHistory(userId, moduleId) {
  const hist = historyFor(userId, moduleId);
  setMain(`
    <a href="#/" class="btn-link">← Übersicht</a>
    <h1 style="margin-top:12px">Frühere Versuche</h1>
    <p class="muted">${esc(userName(userId))} · ${esc(moduleTitle(moduleId))}</p>
    <div class="card">
      ${hist.length ? `<table class="list-table"><thead><tr><th>Archiviert</th><th>Status damals</th><th>Punkte</th><th></th></tr></thead><tbody>
        ${hist.map((h) => `<tr>
          <td>${fmtDate(h.archivedAt)}</td>
          <td>${statusBadge(h.status)}</td>
          <td data-label="Punkte">${typeof h.score === "number" ? `${fmtPoints(h.score)} / ${fmtPoints(h.maxScore ?? 0)}` : "–"}</td>
          <td><div class="actions"><a class="btn btn-small" href="#/archiv/${encodeURIComponent(h._id)}">Ansehen</a></div></td>
        </tr>`).join("")}</tbody></table>` : `<p class="muted">Keine archivierten Versuche.</p>`}
    </div>`);
}

async function resetAttempt(attemptId) {
  const a = state.attempts.find((x) => x._id === attemptId) || state.review?.attempt;
  const label = a ? `${userName(a.userId)} – «${moduleTitle(a.moduleId)}»` : attemptId;
  if (!confirm(`Modul zurücksetzen?\n\n${label}\n\nDer aktuelle Versuch wird archiviert (nicht gelöscht). Danach kann das Modul neu gestartet werden.`)) return;
  try {
    const ref = doc(db, "attempts", attemptId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("Versuch nicht gefunden.");
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "attemptHistory")), {
      ...snap.data(),
      originalAttemptId: attemptId,
      archivedAt: serverTimestamp(),
      archivedBy: state.user.email,
    });
    batch.delete(ref);
    await batch.commit();
    toast("Modul zurückgesetzt, alter Versuch archiviert.", "ok");
    if (location.hash.startsWith("#/review/")) location.hash = "#/";
    else await route();
  } catch (err) {
    toast(`Zurücksetzen fehlgeschlagen: ${errorText(err)}`, "error");
  }
}

// ---------- Korrektur ----------

async function openReview(collectionName, id) {
  const archived = collectionName === "attemptHistory";
  const ref = doc(db, collectionName, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    showError(archived ? "Archivierter Versuch nicht gefunden." : "Dieser Versuch existiert nicht (mehr) – evtl. wurde er zurückgesetzt.");
    return;
  }
  const attempt = snap.data();
  attempt.answers ||= {};
  const [mSnap, sSnap, kSnap, uSnap] = await Promise.all([
    getDoc(doc(db, "modules", attempt.moduleId)),
    getDoc(doc(db, "moduleSolutions", attempt.moduleId)),
    getDoc(doc(db, "moduleKeys", attempt.moduleId)),
    getDoc(doc(db, "users", attempt.userId)),
  ]);
  if (!mSnap.exists()) {
    showError(`Das Modul «${attempt.moduleId}» existiert nicht mehr.`);
    return;
  }
  state.review = {
    id,
    ref,
    archived,
    attempt,
    module: { ...mSnap.data(), id: mSnap.id },
    solutions: sSnap.exists() ? sSnap.data().questions || {} : {},
    modelAnswers: kSnap.exists() ? kSnap.data().questions || {} : {},
    userName: uSnap.exists() ? uSnap.data().name : "(gelöscht)",
    timers: new Map(),
    dirty: false,
  };
  renderReview();
}

function editable() {
  const r = state.review;
  return r && !r.archived && ["submitted", "reviewed"].includes(r.attempt.status);
}

function renderReview() {
  const r = state.review;
  const { module, attempt } = r;
  const canEdit = editable();
  document.title = `${r.userName} – ${module.title}`;

  const answeredIds = new Set(module.questions.map((q) => q.id));
  const orphaned = Object.keys(attempt.answers).filter((k) => !answeredIds.has(k));

  const items = module.questions.map((q, i) => {
    const a = attempt.answers[q.id];
    if (q.type === "mc") {
      const chosen = Array.isArray(a?.value) ? a.value : [];
      const sol = r.solutions[q.id];
      const res = mcResult(q, { value: a?.value }, r.solutions);
      return `
        <div class="card question">
          ${res === null ? "" : res ? `<span class="badge r-correct result-pill">✓ Richtig</span>` : `<span class="badge r-wrong result-pill">✗ Falsch</span>`}
          <div class="qnum">Frage ${i + 1} · Multiple Choice</div>
          <div class="qtext">${esc(q.text)}</div>
          <div class="options">${q.options.map((opt, oi) => {
            const isChosen = chosen.includes(oi);
            const isRight = sol?.correct.includes(oi);
            const cls = isRight ? "is-correct" : isChosen ? "is-wrong" : "";
            const mark = isChosen ? (isRight ? "✓ gewählt" : "✗ gewählt") : isRight ? "richtig" : "";
            return `<div class="option readonly ${cls}"><span class="opt-letter">${letter(oi)}</span><span>${esc(opt)}</span>${mark ? `<span class="mark">${mark}</span>` : ""}</div>`;
          }).join("")}</div>
          ${!chosen.length ? `<p class="small muted" style="margin-top:8px">Nicht beantwortet.</p>` : ""}
          ${sol?.explanation ? `<div class="explanation small"><strong>Erklärung:</strong> ${escMultiline(sol.explanation)}</div>` : ""}
        </div>`;
    }
    const text = typeof a?.value === "string" ? a.value.trim() : "";
    const rating = a?.review?.rating;
    const comment = a?.review?.comment || "";
    const hint = safeUrl(q.hintUrl);
    return `
      <div class="card question" data-qid="${esc(q.id)}">
        <div class="qnum">Frage ${i + 1} · Offene Frage</div>
        <div class="review-grid" style="margin-top:8px">
          <div><div class="col-label">Frage</div><div class="qtext" style="margin:0">${esc(q.text)}</div>
            ${hint ? `<a class="hint" href="${esc(hint)}" target="_blank" rel="noopener noreferrer">Produktseite ↗</a>` : ""}</div>
          <div><div class="col-label">Antwort</div><div class="answer-box ${text ? "" : "empty"}">${text ? esc(text) : "Nicht beantwortet."}</div></div>
          <div><div class="col-label">Musterantwort</div><div class="answer-box model-answer">${escMultiline(r.modelAnswers[q.id] || "–")}</div></div>
        </div>
        ${canEdit ? `
          <div class="rating-buttons">
            ${Object.entries(RATING).map(([key, def]) =>
              `<button type="button" class="btn-small ${def.cls} ${rating === key ? "selected" : ""}" data-rate="${key}">${def.label}</button>`).join("")}
          </div>
          <textarea class="review-comment" placeholder="Kommentar (optional, sieht der Lernende)" maxlength="2000">${esc(comment)}</textarea>`
        : `${RATING[rating] ? `<p style="margin-top:10px"><span class="badge ${RATING[rating].cls}">${RATING[rating].label}</span></p>` : ""}
           ${comment ? `<div class="comment">${escMultiline(comment)}</div>` : ""}`}
      </div>`;
  }).join("");

  setMain(`
    <a href="#/" class="btn-link">← Übersicht</a>
    <div class="card" style="margin-top:12px">
      <div class="row between">
        <div>
          <h1 style="margin:0">${esc(r.userName)} · ${esc(module.title)}</h1>
          <p class="small muted" style="margin:4px 0 0">
            Gestartet ${fmtDate(attempt.startedAt)}
            ${attempt.submittedAt ? ` · eingereicht ${fmtDate(attempt.submittedAt)}` : ""}
            ${attempt.reviewedAt ? ` · korrigiert ${fmtDate(attempt.reviewedAt)}` : ""}
            ${r.archived ? ` · archiviert ${fmtDate(attempt.archivedAt)}` : ""}
          </p>
        </div>
        <div class="row">
          ${statusBadge(attempt.status)}
          ${r.archived ? "" : `<button type="button" class="btn-small btn-danger" id="resetBtn">Zurücksetzen</button>`}
        </div>
      </div>
      ${r.archived ? `<div class="notice warn" style="margin:12px 0 0">Archivierter Versuch – nur Ansicht.</div>` : ""}
      ${attempt.status === "in_progress" && !r.archived ? `<div class="notice info" style="margin:12px 0 0">Noch in Bearbeitung (${countAnswered(module.questions, attempt.answers)} von ${module.questions.length} beantwortet). Korrigieren ist nach dem Einreichen möglich.</div>` : ""}
      ${orphaned.length ? `<div class="notice warn" style="margin:12px 0 0">Antworten zu Fragen, die es im Modul nicht mehr gibt: ${orphaned.map(esc).join(", ")}</div>` : ""}
      <div class="summary-grid" style="margin-top:12px" id="reviewStats"></div>
    </div>
    ${items}`);

  document.getElementById("resetBtn")?.addEventListener("click", () => resetAttempt(r.id));
  appEl.querySelectorAll("[data-rate]").forEach((b) =>
    b.addEventListener("click", () => setRating(b.closest(".question").dataset.qid, b.dataset.rate)));
  appEl.querySelectorAll(".review-comment").forEach((t) => {
    t.addEventListener("input", () => queueComment(t.closest(".question").dataset.qid, t.value));
    t.addEventListener("blur", () => flushComments());
  });

  updateReviewSummary();
}

function updateReviewSummary() {
  const r = state.review;
  if (!r) return;
  const { module, attempt } = r;
  const s = computeScore(module.questions, stripStoredMc(attempt.answers), r.solutions);
  const stats = document.getElementById("reviewStats");
  if (stats) {
    stats.innerHTML = `
      <div class="stat"><div class="num">${fmtPoints(s.score)} / ${s.maxScore}</div><div class="lbl">Punkte${attempt.status === "reviewed" ? "" : " (vorläufig)"}</div></div>
      <div class="stat"><div class="num">${s.mcCorrect} / ${s.mcTotal}</div><div class="lbl">MC richtig</div></div>
      <div class="stat"><div class="num">${s.openRated} / ${s.openTotal}</div><div class="lbl">Offene bewertet</div></div>
      <div class="stat"><div class="num">${countAnswered(module.questions, attempt.answers)} / ${module.questions.length}</div><div class="lbl">Beantwortet</div></div>`;
  }

  if (!editable()) {
    hideReviewBar();
    return;
  }
  reviewBar.classList.remove("hidden");
  const missing = s.openNeedRating;
  reviewSummary.innerHTML = `<strong>${fmtPoints(s.score)} / ${s.maxScore} Punkte</strong> · MC ${s.mcCorrect}/${s.mcTotal} · offen ${fmtPoints(s.openPoints)}/${s.openTotal}
    ${missing ? `<br><span class="muted">Noch ${missing} offene ${missing === 1 ? "Antwort" : "Antworten"} bewerten</span>` : ""}
    ${attempt.status === "reviewed" && r.dirty ? `<br><span class="muted">Geändert – Punktzahl neu speichern</span>` : ""}`;
  finalizeBtn.textContent = attempt.status === "reviewed" ? "Korrektur aktualisieren" : "Als korrigiert abschliessen";
  finalizeBtn.disabled = missing > 0 || (attempt.status === "reviewed" && !r.dirty);
}

/** Für die Admin-Berechnung immer frisch aus den Lösungen rechnen. */
function stripStoredMc(answers) {
  const out = {};
  for (const [k, v] of Object.entries(answers || {})) {
    const { correct, ...rest } = v || {};
    out[k] = rest;
  }
  return out;
}

function hideReviewBar() {
  reviewBar.classList.add("hidden");
}

async function saveReview(qid) {
  const r = state.review;
  const a = r.attempt.answers[qid] || {};
  const review = { rating: a.review?.rating ?? null, comment: a.review?.comment ?? "" };
  await updateDoc(r.ref, { [`answers.${qid}.review`]: review, updatedAt: serverTimestamp() });
}

async function setRating(qid, rating) {
  const r = state.review;
  const a = (r.attempt.answers[qid] ||= {});
  a.review = { ...(a.review || {}), rating };
  r.dirty = true;
  const card = appEl.querySelector(`.question[data-qid="${CSS.escape(qid)}"]`);
  card?.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("selected", b.dataset.rate === rating));
  updateReviewSummary();
  try {
    await saveReview(qid);
  } catch (err) {
    toast(`Bewertung nicht gespeichert: ${errorText(err)}`, "error");
  }
}

function queueComment(qid, value) {
  const r = state.review;
  const a = (r.attempt.answers[qid] ||= {});
  a.review = { ...(a.review || {}), comment: value };
  clearTimeout(r.timers.get(qid));
  r.timers.set(qid, setTimeout(() => {
    r.timers.delete(qid);
    saveReview(qid).catch((err) => toast(`Kommentar nicht gespeichert: ${errorText(err)}`, "error"));
  }, 800));
}

async function flushComments() {
  const r = state.review;
  if (!r) return;
  const pending = [...r.timers.keys()];
  r.timers.forEach((t) => clearTimeout(t));
  r.timers.clear();
  await Promise.all(pending.map((qid) => saveReview(qid).catch((err) =>
    toast(`Kommentar nicht gespeichert: ${errorText(err)}`, "error"))));
}

async function leaveReview() {
  if (state.review) await flushComments();
  state.review = null;
}

finalizeBtn.addEventListener("click", async () => {
  const r = state.review;
  if (!r || !editable()) return;
  await flushComments();
  const { module, attempt } = r;
  const s = computeScore(module.questions, stripStoredMc(attempt.answers), r.solutions);
  if (s.openNeedRating) {
    toast("Bitte zuerst alle beantworteten offenen Fragen bewerten.", "error");
    return;
  }
  const update = {
    status: "reviewed",
    reviewedAt: serverTimestamp(),
    reviewedBy: state.user.email,
    score: s.score,
    maxScore: s.maxScore,
    updatedAt: serverTimestamp(),
  };
  for (const q of module.questions) {
    if (q.type !== "mc") continue;
    const res = mcResult(q, { value: attempt.answers[q.id]?.value }, r.solutions);
    if (res !== null) update[`answers.${q.id}.correct`] = res;
  }
  finalizeBtn.disabled = true;
  try {
    await updateDoc(r.ref, update);
    toast(`Korrektur gespeichert: ${fmtPoints(s.score)} / ${s.maxScore} Punkte`, "ok");
    await openReview("attempts", r.id);
  } catch (err) {
    finalizeBtn.disabled = false;
    toast(`Speichern fehlgeschlagen: ${errorText(err)}`, "error");
  }
});

window.addEventListener("beforeunload", (e) => {
  if (state.review?.timers.size) {
    flushComments();
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------- Modulverwaltung ----------

function renderModules() {
  const mods = state.modules;
  const rows = mods.map((m, i) => {
    const nAttempts = state.attempts.filter((a) => a.moduleId === m.id).length;
    const mc = (m.questions || []).filter((q) => q.type === "mc").length;
    return `
      <tr class="${m.active ? "" : "inactive"}">
        <td data-label="Pos.">${i + 1}</td>
        <td><strong>${esc(m.title)}</strong><br><span class="small muted mono">${esc(m.id)}</span>${m.productArea ? ` <span class="tag">${esc(m.productArea)}</span>` : ""}</td>
        <td data-label="Fragen">${m.questions?.length || 0} <span class="small muted">(${mc} MC)</span></td>
        <td data-label="Versuche">${nAttempts}</td>
        <td data-label="Importiert" class="small">${fmtDate(m.importedAt, false)}</td>
        <td><label class="row" style="gap:8px;cursor:pointer">
          <span class="switch"><input type="checkbox" data-active="${esc(m.id)}" ${m.active ? "checked" : ""}><span class="slider"></span></span>
          <span class="small">${m.active ? "aktiv" : "inaktiv"}</span></label></td>
        <td><div class="actions">
          <button type="button" class="btn-small" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Nach oben">↑</button>
          <button type="button" class="btn-small" data-move="${i}" data-dir="1" ${i === mods.length - 1 ? "disabled" : ""} aria-label="Nach unten">↓</button>
          <button type="button" class="btn-small" data-export="${esc(m.id)}">JSON</button>
        </div></td>
      </tr>`;
  }).join("");

  setMain(`
    <div class="row between" style="margin-bottom:12px">
      <h1 style="margin:0">Module</h1>
      <a class="btn btn-primary" href="#/import">Module importieren</a>
    </div>
    <div class="card">
      ${mods.length
        ? `<table class="list-table"><thead><tr><th>#</th><th>Modul</th><th>Fragen</th><th>Versuche</th><th>Importiert</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>
           <p class="small muted" style="margin:12px 0 0">Die Reihenfolge gilt auch für die Lernenden. Inaktive Module sehen Lernende nicht.</p>`
        : `<p class="muted" style="margin:0">Noch keine Module. <a href="#/import">Jetzt importieren</a>.</p>`}
    </div>`);

  appEl.querySelectorAll("[data-active]").forEach((input) =>
    input.addEventListener("change", async () => {
      const id = input.dataset.active;
      try {
        await updateDoc(doc(db, "modules", id), { active: input.checked });
        const m = state.modules.find((x) => x.id === id);
        m.active = input.checked;
        toast(`«${m.title}» ist jetzt ${input.checked ? "aktiv" : "inaktiv"}.`, "ok");
        renderModules();
      } catch (err) {
        input.checked = !input.checked;
        toast(errorText(err), "error");
      }
    }));

  appEl.querySelectorAll("[data-move]").forEach((b) =>
    b.addEventListener("click", () => moveModule(Number(b.dataset.move), Number(b.dataset.dir))));

  appEl.querySelectorAll("[data-export]").forEach((b) =>
    b.addEventListener("click", () => exportModule(b.dataset.export)));
}

async function moveModule(index, dir) {
  const list = [...state.modules];
  const target = index + dir;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  const batch = writeBatch(db);
  let changes = 0;
  list.forEach((m, i) => {
    if (m.order !== i + 1) {
      batch.update(doc(db, "modules", m.id), { order: i + 1 });
      m.order = i + 1;
      changes++;
    }
  });
  try {
    if (changes) await batch.commit();
    state.modules = list;
    renderModules();
  } catch (err) {
    toast(`Reihenfolge nicht gespeichert: ${errorText(err)}`, "error");
    await route();
  }
}

async function exportModule(id) {
  try {
    const snap = await getDoc(doc(db, "moduleKeys", id));
    if (!snap.exists() || !snap.data().source) throw new Error("Original-JSON nicht gefunden.");
    const blob = new Blob([snap.data().source], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (err) {
    toast(errorText(err), "error");
  }
}

// ---------- Import ----------

function renderImport() {
  state.importDraft = null;
  setMain(`
    <h1>Module importieren</h1>
    <div class="card">
      <p class="muted">JSON einfügen oder Datei wählen. Ein Modul <code>{ … }</code> oder mehrere als Array <code>[ … ]</code>.
        Bestehende Module mit gleicher <code>id</code> werden ersetzt (Aktiv-Status und Reihenfolge bleiben).</p>
      <div class="file-drop" id="drop">
        JSON-Datei hierher ziehen oder
        <label class="btn-link" style="cursor:pointer">Datei wählen<input type="file" id="fileInput" accept=".json,application/json" multiple hidden></label>
      </div>
      <textarea class="mono" id="jsonInput" style="margin-top:12px" spellcheck="false" placeholder='{ "id": "velobekleidung-01", "title": "Velobekleidung", "questions": [ … ] }'></textarea>
      <div class="row" style="margin-top:12px">
        <button type="button" class="btn-primary" id="checkBtn">Prüfen &amp; Vorschau</button>
        <button type="button" id="clearBtn">Leeren</button>
      </div>
    </div>
    <div id="importResult"></div>`);

  const input = document.getElementById("jsonInput");
  const drop = document.getElementById("drop");
  document.getElementById("checkBtn").addEventListener("click", () => checkImport(input.value));
  document.getElementById("clearBtn").addEventListener("click", () => {
    input.value = "";
    document.getElementById("importResult").innerHTML = "";
    state.importDraft = null;
  });
  document.getElementById("fileInput").addEventListener("change", (e) => loadFiles(e.target.files));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    loadFiles(e.dataTransfer.files);
  });
}

async function loadFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const input = document.getElementById("jsonInput");
  const texts = await Promise.all(files.map((f) => f.text()));
  if (texts.length === 1) {
    input.value = texts[0];
  } else {
    // Mehrere Dateien zu einem Array zusammenfassen.
    const all = [];
    for (let i = 0; i < texts.length; i++) {
      const parsed = parseModulesInput(texts[i]);
      if (parsed.error) {
        input.value = texts[i];
        renderImportError(`${files[i].name}: ${parsed.error}`);
        return;
      }
      all.push(...parsed.modules);
    }
    input.value = JSON.stringify(all, null, 2);
  }
  checkImport(input.value);
}

function renderImportError(message) {
  document.getElementById("importResult").innerHTML = `<div class="notice error">${esc(message)}</div>`;
}

function checkImport(text) {
  state.importDraft = null;
  const parsed = parseModulesInput(text);
  if (parsed.error) {
    renderImportError(parsed.error);
    return;
  }
  const results = validateImport(parsed.modules);
  const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);

  const cards = results.map((r, i) => {
    const m = r.module || {};
    const existing = typeof m.id === "string" ? state.modules.find((x) => x.id === m.id) : null;
    const extraWarnings = [];
    if (existing && Array.isArray(m.questions)) {
      const newIds = new Set(m.questions.map((q) => q?.id));
      const removed = (existing.questions || []).map((q) => q.id).filter((id) => !newIds.has(id));
      const nAttempts = state.attempts.filter((a) => a.moduleId === m.id).length;
      if (removed.length && nAttempts) {
        extraWarnings.push(`Fragen ${removed.join(", ")} fallen weg – ${nAttempts} bestehende Versuche haben evtl. Antworten dazu.`);
      }
    }
    const warnings = [...r.warnings, ...extraWarnings];
    const qs = Array.isArray(m.questions) ? m.questions : [];
    const mc = qs.filter((q) => q?.type === "mc").length;
    const open = qs.filter((q) => q?.type === "open").length;
    const preview = qs.map((q, qi) => {
      if (!q || typeof q !== "object") return "";
      let detail = "";
      if (q.type === "mc" && Array.isArray(q.options)) {
        detail = `<div>${q.options.map((o, oi) => {
          const right = Array.isArray(q.correct) && q.correct.includes(oi);
          return `<div class="${right ? "" : "muted"}">${right ? "✓" : "&nbsp;&nbsp;"} ${letter(oi)}) ${right ? `<strong>${esc(o)}</strong>` : esc(o)}</div>`;
        }).join("")}</div>${q.explanation ? `<div class="small muted">Erklärung: ${esc(q.explanation)}</div>` : ""}`;
      } else if (q.type === "open") {
        detail = `<div class="small"><span class="muted">Musterantwort:</span> ${esc(q.modelAnswer || "–")}</div>`;
      }
      const hint = safeUrl(q.hintUrl);
      return `<div class="preview-q">
        <div><span class="tag">${esc(q.id || `#${qi + 1}`)}</span> <span class="tag">${q.type === "mc" ? "MC" : q.type === "open" ? "offen" : esc(q.type)}</span> <strong>${esc(q.text || "")}</strong></div>
        ${detail}
        ${hint ? `<div class="small"><a href="${esc(hint)}" target="_blank" rel="noopener noreferrer">Hinweis-Link ↗</a></div>` : ""}
      </div>`;
    }).join("");

    return `
      <div class="card">
        <div class="row between">
          <div>
            <h2 style="margin:0">${esc(m.title || `Modul ${i + 1}`)}</h2>
            <span class="small muted mono">${esc(m.id || "ohne id")}</span>
            ${m.productArea ? ` <span class="tag">${esc(m.productArea)}</span>` : ""}
          </div>
          ${r.errors.length ? `<span class="badge r-wrong">${r.errors.length} Fehler</span>`
            : `<span class="badge r-correct">Bereit</span>`}
        </div>
        ${m.description ? `<p style="margin:8px 0 0">${esc(m.description)}</p>` : ""}
        <p class="small muted" style="margin:6px 0 12px">${qs.length} Fragen · ${mc} MC · ${open} offen
          ${existing ? ` · <strong>ersetzt bestehendes Modul</strong> (importiert ${fmtDate(existing.importedAt, false)}, ${existing.active ? "aktiv" : "inaktiv"})` : " · neu"}</p>
        ${r.errors.length ? `<div class="notice error"><strong>Fehler – so nicht speicherbar:</strong><ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
        ${warnings.length ? `<div class="notice warn"><strong>Hinweise:</strong><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
        ${qs.length ? `<details><summary>Fragen anzeigen (${qs.length})</summary><div style="margin-top:8px">${preview}</div></details>` : ""}
      </div>`;
  }).join("");

  const hasNew = results.some((r) => !state.modules.find((x) => x.id === r.module?.id));
  const footer = totalErrors
    ? `<div class="notice error">Bitte die Fehler im JSON korrigieren und erneut prüfen.</div>`
    : `<div class="card row between">
        ${hasNew ? `<label class="row" style="gap:8px"><input type="checkbox" id="activateNew" checked style="width:18px;height:18px"> Neue Module sofort aktivieren</label>` : "<span></span>"}
        <button type="button" class="btn-primary" id="saveImportBtn">${results.length === 1 ? "Modul speichern" : `${results.length} Module speichern`}</button>
      </div>`;

  document.getElementById("importResult").innerHTML = cards + footer;
  if (!totalErrors) {
    state.importDraft = parsed.modules;
    document.getElementById("saveImportBtn").addEventListener("click", saveImport);
  }
}

async function saveImport() {
  const modules = state.importDraft;
  if (!modules) return;
  const btn = document.getElementById("saveImportBtn");
  const activateNew = document.getElementById("activateNew")?.checked ?? true;
  btn.disabled = true;
  try {
    await loadAll(); // aktuelle Reihenfolge/Status holen
    let maxOrder = state.modules.reduce((mx, m) => Math.max(mx, m.order || 0), 0);
    const batch = writeBatch(db);
    for (const m of modules) {
      const { publicDoc, solutionsDoc, keysDoc } = splitModule(m);
      const existing = state.modules.find((x) => x.id === m.id);
      batch.set(doc(db, "modules", m.id), {
        ...publicDoc,
        active: existing ? !!existing.active : activateNew,
        order: existing?.order ?? ++maxOrder,
        importedAt: serverTimestamp(),
      });
      batch.set(doc(db, "moduleSolutions", m.id), solutionsDoc);
      batch.set(doc(db, "moduleKeys", m.id), keysDoc);
    }
    await batch.commit();
    toast(modules.length === 1 ? "Modul gespeichert." : `${modules.length} Module gespeichert.`, "ok");
    location.hash = "#/module";
  } catch (err) {
    btn.disabled = false;
    toast(`Speichern fehlgeschlagen: ${errorText(err)}`, "error");
  }
}
