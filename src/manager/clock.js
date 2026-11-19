import { changeClock } from '../playlist.js';
import { fail } from './store.js';

const DAY = 86400000;
export const validTime = (v) =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export function validateCadence(c) {
  if (
    !c ||
    !Number.isInteger(c.everyMin) ||
    c.everyMin < 1 ||
    c.everyMin > 525600 ||
    !validTime(c.at) ||
    (c.until !== undefined && !validTime(c.until))
  )
    throw fail('Ungültiger Wechselrhythmus');
  if (c.everyMin > 1440 && c.everyMin % 1440)
    throw fail('Mehrere Tage müssen ganze Kalendertage sein');
  return {
    everyMin: c.everyMin,
    at: c.at,
    ...(c.until !== undefined ? { until: c.until } : {}),
  };
}

export function cadenceFromCron(pattern) {
  const fields = pattern.trim().split(/\s+/);
  if (fields.length === 6 && fields[0] === '0') fields.shift();
  const [minute, hour] = fields;
  if (minute === '0' && hour === '0,6-23')
    return { everyMin: 60, at: '06:00', until: '00:00' };
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour))
    return {
      everyMin: 1440,
      at: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
    };
  if (minute === '0' && hour === '*') return { everyMin: 60, at: '00:00' };
  if (/^\*\/\d+$/.test(minute) && hour === '*')
    return { everyMin: Number(minute.slice(2)), at: '00:00' };
  return { everyMin: 1440, at: '06:00', legacyCron: pattern };
}

function localDate(t, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
}
function dayNumber(date) {
  return Date.parse(`${date}T00:00:00Z`) / DAY;
}

/** Calendar days use a local date anchor; hours use elapsed time. Windows include their end. */
export function cadenceClock(
  c,
  timezone = 'Europe/Berlin',
  anchor = Date.now(),
) {
  if (c.legacyCron) return changeClock(c.legacyCron, timezone);
  validateCadence(c);
  const [h, m] = c.at.split(':').map(Number);
  const daily = changeClock(`${m} ${h} * * *`, timezone);
  const days = c.everyMin >= 1440 ? c.everyMin / 1440 : 1;
  const anchorDay = dayNumber(localDate(anchor, timezone));
  const aligned = (t) =>
    (((dayNumber(localDate(t, timezone)) - anchorDay) % days) + days) % days ===
    0;
  function candidates(t) {
    if (c.everyMin >= 1440) {
      const result = [];
      let date = daily.prev(t - (days + 2) * DAY);
      for (let i = 0; i < days * 3 + 12; i++) {
        if (aligned(date)) result.push(date);
        date = daily.next(date);
      }
      return result;
    }
    if (!c.until) {
      const base = daily.prev(anchor);
      const gap = c.everyMin * 60000;
      const prev = base + Math.floor((t - base) / gap) * gap;
      return [prev - gap, prev, prev + gap, prev + 2 * gap];
    }
    const [eh, em] = c.until.split(':').map(Number);
    const endClock = changeClock(`${em} ${eh} * * *`, timezone);
    const result = [];
    let start = daily.prev(t - 2 * DAY);
    for (let d = 0; d < 6; d++) {
      const end = endClock.next(start);
      for (let x = start; x <= end; x += c.everyMin * 60000) result.push(x);
      start = daily.next(start);
    }
    return [...new Set(result)].sort((a, b) => a - b);
  }
  const next = (t) => candidates(t).find((x) => x > t) ?? null;
  return {
    next,
    prev: (t) =>
      candidates(t)
        .filter((x) => x <= t)
        .at(-1) ?? null,
    upcoming(n, t) {
      const out = [];
      while (out.length < n) {
        t = next(t);
        if (t === null) break;
        out.push(t);
      }
      return out;
    },
  };
}
