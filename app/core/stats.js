// Statistikk og vinnerlogikk. Ren logikk – testes i /tests.
import { WinnerMode, fullName } from './events.js';

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Sammenligner registreringstidspunkt: tidligst først (tidsstempel, deretter rekkefølge i loggen).
export function compareRegistration(a, b) {
  const ta = Date.parse(a.registeredAt);
  const tb = Date.parse(b.registeredAt);
  if (ta !== tb) return ta - tb;
  return (a.registeredSeq ?? 0) - (b.registeredSeq ?? 0);
}

// Beste gyldige tid per deltaker (slettede og ugyldige forsøk teller ikke). Deltakere uten gyldig tid er ikke med.
export function bestTimes(state) {
  const out = [];
  for (const p of state.participants.values()) {
    const ids = state.attemptsByParticipant.get(p.id) ?? [];
    let best = null;
    let validCount = 0;
    for (const id of ids) {
      const a = state.attempts.get(id);
      if (!a || a.deleted || !a.valid || !Number.isFinite(a.cs)) continue;
      validCount += 1;
      if (!best || a.cs < best.cs || (a.cs === best.cs && a.recordedSeq < best.recordedSeq)) best = a;
    }
    if (best) out.push({ participant: p, bestCs: best.cs, bestAttemptId: best.id, validCount });
  }
  return out;
}

export function computeStats(state) {
  const bests = bestTimes(state);
  let attemptCount = 0;
  let validAttemptCount = 0;
  let deletedAttemptCount = 0;
  for (const a of state.attempts.values()) {
    if (a.deleted) { deletedAttemptCount += 1; continue; }
    attemptCount += 1;
    if (a.valid) validAttemptCount += 1;
  }
  const bestOverall = bests.length ? Math.min(...bests.map((b) => b.bestCs)) : null;
  return {
    participantCount: state.participants.size,
    participantsWithTime: bests.length,
    attemptCount,
    validAttemptCount,
    invalidAttemptCount: attemptCount - validAttemptCount,
    deletedAttemptCount,
    bestCs: bestOverall,
    medianCs: median(bests.map((b) => b.bestCs)),
  };
}

// Rangerer etter valgt modus. Hver rad: { rank, participant, bestCs, distance, tiedWithPrevious, tieGroupSize }
// Ved likhet på primærkriteriet vinner tidligste registrering, og raden merkes som uavgjort.
export function rank(state, mode = state.settings.winnerMode) {
  const bests = bestTimes(state);
  const med = median(bests.map((b) => b.bestCs));
  const key = mode === WinnerMode.MEDIAN ? (b) => Math.abs(b.bestCs - med) : (b) => b.bestCs;
  const rows = bests.map((b) => ({ ...b, distance: mode === WinnerMode.MEDIAN ? Math.abs(b.bestCs - med) : null, key: key(b) }));
  rows.sort((a, b) => (a.key - b.key) || compareRegistration(a.participant, b.participant));
  // Antall med samme nøkkel (uavgjort på primærkriteriet)
  const groupSize = new Map();
  for (const r of rows) groupSize.set(r.key, (groupSize.get(r.key) ?? 0) + 1);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.tieGroupSize = groupSize.get(r.key);
    r.tied = r.tieGroupSize > 1;
  });
  return { mode, medianCs: med, rows };
}

export function topN(state, n = 5, mode = state.settings.winnerMode) {
  const r = rank(state, mode);
  return { ...r, rows: r.rows.slice(0, n) };
}

// Vinner for valgt modus. Returnerer null hvis ingen gyldige tider.
export function determineWinner(state, mode = state.settings.winnerMode) {
  const { rows, medianCs } = rank(state, mode);
  if (rows.length === 0) return null;
  const w = rows[0];
  const tiedRows = rows.filter((r) => r.key === w.key);
  return {
    mode,
    medianCs,
    winnerId: w.participant.id,
    winnerName: fullName(w.participant),
    winnerCompany: w.participant.company,
    winnerEmail: w.participant.email,
    winnerCs: w.bestCs,
    winnerDistance: w.distance,
    tie: tiedRows.length > 1,
    tiedWith: tiedRows.slice(1).map((r) => ({ id: r.participant.id, name: fullName(r.participant), cs: r.bestCs, registeredAt: r.participant.registeredAt })),
    top5: rows.slice(0, 5).map((r) => ({
      rank: r.rank, id: r.participant.id, name: fullName(r.participant), company: r.participant.company,
      cs: r.bestCs, distance: r.distance, tied: r.tied, registeredAt: r.participant.registeredAt,
    })),
    participantsWithTime: rows.length,
  };
}
