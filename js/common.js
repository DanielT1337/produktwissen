// Gemeinsame Helfer für Lernenden- und Admin-Ansicht (ohne Firebase-Abhängigkeit).

export const STATUS = {
  open:        { label: "Offen",          cls: "st-open" },
  in_progress: { label: "In Bearbeitung", cls: "st-progress" },
  submitted:   { label: "Eingereicht",    cls: "st-submitted" },
  reviewed:    { label: "Korrigiert",     cls: "st-reviewed" },
};

export const RATING = {
  correct: { label: "Richtig",   points: 1,   cls: "r-correct" },
  partial: { label: "Teilweise", points: 0.5, cls: "r-partial" },
  wrong:   { label: "Falsch",    points: 0,   cls: "r-wrong" },
};

export function statusOf(attempt) {
  return attempt ? attempt.status : "open";
}

export function statusBadge(status) {
  const s = STATUS[status] || STATUS.open;
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Text mit Zeilenumbrüchen sicher als HTML ausgeben. */
export function escMultiline(value) {
  return esc(value).replace(/\n/g, "<br>");
}

export function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
  const d = new Date(ts);
  return isNaN(d) ? null : d;
}

export function fmtDate(ts, withTime = true) {
  const d = toDate(ts);
  if (!d) return "–";
  const opts = { day: "2-digit", month: "2-digit", year: "numeric" };
  if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("de-CH", opts);
}

export function fmtPoints(n) {
  return (Math.round(n * 10) / 10).toLocaleString("de-CH");
}

export function letter(i) {
  return String.fromCharCode(65 + i);
}

export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function isAnswered(question, answer) {
  if (!answer || answer.value == null) return false;
  if (question.type === "mc") return Array.isArray(answer.value) && answer.value.length > 0;
  return String(answer.value).trim().length > 0;
}

export function countAnswered(questions, answers = {}) {
  return questions.filter((q) => isAnswered(q, answers[q.id])).length;
}

export function sameSelection(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/**
 * MC-Ergebnis einer Frage: zuerst das gespeicherte Resultat (nach der Korrektur),
 * sonst aus den Lösungen berechnet. null = unbekannt.
 */
export function mcResult(question, answer, solutions) {
  if (answer && typeof answer.correct === "boolean") return answer.correct;
  const sol = solutions?.[question.id];
  if (!sol) return null;
  return isAnswered(question, answer) && sameSelection(answer.value, sol.correct);
}

/**
 * Punkte: MC richtig = 1, offene Frage richtig = 1 / teilweise = 0.5 / falsch = 0.
 * Unbeantwortete offene Fragen ohne Bewertung zählen 0.
 */
export function computeScore(questions, answers = {}, solutions = {}) {
  const r = { mcTotal: 0, mcCorrect: 0, openTotal: 0, openRated: 0, openNeedRating: 0,
              openPoints: 0, score: 0, maxScore: questions.length };
  for (const q of questions) {
    const a = answers[q.id];
    if (q.type === "mc") {
      r.mcTotal++;
      if (mcResult(q, a, solutions) === true) r.mcCorrect++;
    } else {
      r.openTotal++;
      const rating = a?.review?.rating;
      if (RATING[rating]) {
        r.openRated++;
        r.openPoints += RATING[rating].points;
      } else if (isAnswered(q, a)) {
        r.openNeedRating++;
      }
    }
  }
  r.score = r.mcCorrect + r.openPoints;
  return r;
}

let toastTimer;
export function toast(message, type = "info") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), type === "error" ? 6000 : 3000);
}

export function errorText(err) {
  const code = err?.code || "";
  if (code.includes("permission-denied")) return "Keine Berechtigung für diese Aktion.";
  if (code.includes("unavailable")) return "Keine Verbindung zum Server. Bitte später nochmals versuchen.";
  if (code.includes("not-found")) return "Eintrag nicht gefunden – bitte Seite neu laden.";
  return err?.message || String(err);
}
