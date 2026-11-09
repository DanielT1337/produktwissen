// Validierung des Modul-JSON und Aufteilung in öffentliche und geschützte Teile.
// Keine Firebase-Abhängigkeit, damit es auch in Node getestet werden kann.

const MODULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const QUESTION_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_MODULE_KEYS = ["id", "title", "description", "productArea", "sourceUrl", "createdAt", "questions"];
const KNOWN_QUESTION_KEYS = ["id", "type", "text", "options", "correct", "explanation", "modelAnswer", "hintUrl"];

export const RECOMMENDED_MIN = 40;
export const RECOMMENDED_MAX = 60;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function jsonErrorMessage(err, text) {
  const m = /position (\d+)/.exec(err.message);
  if (m) {
    const pos = Number(m[1]);
    const before = text.slice(0, pos);
    const line = before.split("\n").length;
    const col = pos - before.lastIndexOf("\n");
    return `Ungültiges JSON in Zeile ${line}, Spalte ${col}: ${err.message}`;
  }
  const ff = /line (\d+) column (\d+)/.exec(err.message); // Firefox
  if (ff) return `Ungültiges JSON in Zeile ${ff[1]}, Spalte ${ff[2]}: ${err.message}`;
  return `Ungültiges JSON (häufig: fehlendes oder überzähliges Komma, fehlende Anführungszeichen): ${err.message}`;
}

/** Text → Liste von Modul-Objekten. Akzeptiert ein Modul oder ein Array von Modulen. */
export function parseModulesInput(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { modules: [], error: "Kein JSON eingegeben." };
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (err) {
    return { modules: [], error: jsonErrorMessage(err, trimmed) };
  }
  const modules = Array.isArray(data) ? data : [data];
  if (modules.length === 0) return { modules: [], error: "Das Array enthält keine Module." };
  return { modules, error: null };
}

/** Prüft ein Modul. Fehler verhindern das Speichern, Warnungen nicht. */
export function validateModule(m) {
  const errors = [];
  const warnings = [];

  if (!m || typeof m !== "object" || Array.isArray(m)) {
    return { errors: ["Ein Modul muss ein JSON-Objekt { … } sein."], warnings };
  }

  if (!isNonEmptyString(m.id)) {
    errors.push("«id» fehlt (z. B. \"velobekleidung-01\").");
  } else if (!MODULE_ID_RE.test(m.id)) {
    errors.push(`«id» "${m.id}" ist ungültig: nur Kleinbuchstaben, Ziffern und Bindestriche, max. 80 Zeichen (z. B. "velobekleidung-01").`);
  }
  if (!isNonEmptyString(m.title)) errors.push("«title» fehlt oder ist leer.");

  for (const key of ["description", "productArea"]) {
    if (m[key] == null) warnings.push(`«${key}» fehlt.`);
    else if (typeof m[key] !== "string") errors.push(`«${key}» muss ein Text sein.`);
  }
  if (m.sourceUrl == null) warnings.push("«sourceUrl» fehlt.");
  else if (!isHttpUrl(m.sourceUrl)) errors.push(`«sourceUrl» ist keine gültige URL: "${m.sourceUrl}".`);
  if (m.createdAt == null) warnings.push("«createdAt» fehlt.");
  else if (typeof m.createdAt !== "string" || !DATE_RE.test(m.createdAt)) {
    errors.push(`«createdAt» muss das Format JJJJ-MM-TT haben (z. B. "2026-11-09"), ist aber "${m.createdAt}".`);
  }

  const unknown = Object.keys(m).filter((k) => !KNOWN_MODULE_KEYS.includes(k));
  if (unknown.length) warnings.push(`Unbekannte Felder werden ignoriert: ${unknown.join(", ")}.`);

  if (!Array.isArray(m.questions)) {
    errors.push("«questions» fehlt oder ist kein Array.");
    return { errors, warnings };
  }
  if (m.questions.length === 0) errors.push("«questions» ist leer.");
  else if (m.questions.length < RECOMMENDED_MIN || m.questions.length > RECOMMENDED_MAX) {
    warnings.push(`Das Modul hat ${m.questions.length} Fragen (empfohlen: ${RECOMMENDED_MIN}–${RECOMMENDED_MAX}).`);
  }

  const seen = new Set();
  m.questions.forEach((q, i) => {
    const label = `Frage ${i + 1}${q && isNonEmptyString(q.id) ? ` (${q.id})` : ""}`;
    const err = (msg) => errors.push(`${label}: ${msg}`);
    const warn = (msg) => warnings.push(`${label}: ${msg}`);

    if (!q || typeof q !== "object" || Array.isArray(q)) {
      err("muss ein JSON-Objekt sein.");
      return;
    }
    if (!isNonEmptyString(q.id)) err("«id» fehlt.");
    else if (!QUESTION_ID_RE.test(q.id)) err(`«id» "${q.id}" ist ungültig: nur Buchstaben, Ziffern, - und _ (z. B. "q01").`);
    else if (seen.has(q.id)) err(`«id» "${q.id}" kommt mehrfach vor.`);
    else seen.add(q.id);

    if (!isNonEmptyString(q.text)) err("«text» fehlt oder ist leer.");
    if (q.hintUrl != null && !isHttpUrl(q.hintUrl)) err(`«hintUrl» ist keine gültige URL: "${q.hintUrl}".`);

    const unknownQ = Object.keys(q).filter((k) => !KNOWN_QUESTION_KEYS.includes(k));
    if (unknownQ.length) warn(`unbekannte Felder werden ignoriert: ${unknownQ.join(", ")}.`);

    if (q.type === "mc") {
      if (!Array.isArray(q.options) || q.options.length < 2) {
        err("«options» muss ein Array mit mindestens 2 Antworten sein.");
      } else {
        if (!q.options.every(isNonEmptyString)) err("alle «options» müssen nicht-leere Texte sein.");
        const distinct = new Set(q.options.map((o) => String(o).trim().toLowerCase()));
        if (distinct.size !== q.options.length) warn("«options» enthält doppelte Antworten.");
      }
      const n = Array.isArray(q.options) ? q.options.length : 0;
      if (!Array.isArray(q.correct) || q.correct.length === 0) {
        err("«correct» muss ein Array mit mindestens einem Index sein, z. B. [1] (Zählung beginnt bei 0).");
      } else {
        const bad = q.correct.filter((c) => !Number.isInteger(c) || c < 0 || c >= n);
        if (bad.length) err(`«correct» enthält ungültige Indizes: ${JSON.stringify(bad)}. Erlaubt sind 0 bis ${n - 1} (Zählung beginnt bei 0).`);
        if (new Set(q.correct).size !== q.correct.length) err("«correct» enthält doppelte Indizes.");
        if (n > 0 && q.correct.length === n) warn("alle Antworten sind als richtig markiert.");
      }
      if (q.explanation != null && typeof q.explanation !== "string") err("«explanation» muss ein Text sein.");
      if (q.modelAnswer != null) warn("«modelAnswer» wird bei Multiple-Choice-Fragen ignoriert.");
    } else if (q.type === "open") {
      if (!isNonEmptyString(q.modelAnswer)) err("«modelAnswer» fehlt (bei offenen Fragen Pflicht).");
      if (q.options != null || q.correct != null) warn("«options»/«correct» werden bei offenen Fragen ignoriert.");
      if (q.explanation != null && typeof q.explanation !== "string") err("«explanation» muss ein Text sein.");
    } else {
      err(`«type» muss "mc" oder "open" sein, ist aber ${JSON.stringify(q.type)}.`);
    }
  });

  return { errors, warnings };
}

/** Prüft mehrere Module inkl. doppelter IDs innerhalb des Imports. */
export function validateImport(modules) {
  const results = modules.map((m) => ({ module: m, ...validateModule(m) }));
  const ids = new Map();
  results.forEach((r, i) => {
    const id = r.module?.id;
    if (typeof id !== "string") return;
    if (ids.has(id)) r.errors.push(`Die Modul-ID "${id}" kommt im Import mehrfach vor (auch Modul ${ids.get(id) + 1}).`);
    else ids.set(id, i);
  });
  return results;
}

/**
 * Teilt ein gültiges Modul in drei Dokumente:
 *  - publicDoc     → modules/{id}          (für alle lesbar, ohne Lösungen)
 *  - solutionsDoc  → moduleSolutions/{id}  (MC-Lösungen + Erklärungen, erst nach der Einreichung lesbar)
 *  - keysDoc       → moduleKeys/{id}       (Musterantworten + Original-JSON, nur Admin)
 */
export function splitModule(m) {
  const publicQuestions = [];
  const solutions = {};
  const modelAnswers = {};
  for (const q of m.questions) {
    const pq = { id: q.id, type: q.type, text: q.text };
    if (q.hintUrl) pq.hintUrl = q.hintUrl;
    if (q.type === "mc") {
      pq.options = q.options;
      pq.multiple = q.correct.length > 1;
      solutions[q.id] = { correct: q.correct, explanation: q.explanation || "" };
    } else {
      modelAnswers[q.id] = q.modelAnswer;
    }
    publicQuestions.push(pq);
  }
  const publicDoc = {
    id: m.id,
    title: m.title,
    description: m.description || "",
    productArea: m.productArea || "",
    sourceUrl: m.sourceUrl || "",
    createdAt: m.createdAt || "",
    questionCount: m.questions.length,
    questions: publicQuestions,
  };
  return {
    publicDoc,
    solutionsDoc: { questions: solutions },
    keysDoc: { questions: modelAnswers, source: JSON.stringify(m, null, 2) },
  };
}
