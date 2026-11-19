const DAY = 86400000;
export function batteryEstimate(
  log,
  cadence,
  now = Date.now(),
  incident = false,
) {
  const last = log?.at(-1);
  if (!last || last.charging || now - last.at > 2 * DAY || incident)
    return null;
  let start = log.length - 1;
  while (
    start > 0 &&
    !log[start - 1].charging &&
    log[start].percent <= log[start - 1].percent + 1
  )
    start--;
  const samples = log.slice(start);
  if (samples.length < 4 || last.at - samples[0].at < 2 * DAY) return null;
  const rates = [];
  for (let i = 0; i < samples.length - 1; i++)
    for (let j = i + 1; j < samples.length; j++) {
      const elapsed = samples[j].at - samples[i].at;
      if (elapsed >= DAY / 2) {
        const rate =
          (samples[i].percent - samples[j].percent) / (elapsed / DAY);
        if (rate > 0 && rate < 25) rates.push(rate);
      }
    }
  if (!rates.length) return null;
  rates.sort((a, b) => a - b);
  const rate = rates[Math.floor(rates.length / 2)];
  const days = Math.max(0, last.percent - 10) / rate;
  if (!Number.isFinite(days) || days > 365) return null;
  return {
    until: last.at + Math.floor(days) * DAY,
    changesLeft: Math.floor((days * 1440) / cadence.everyMin),
  };
}

export class Status {
  publicFrame(f, detail = false) {
    const app = this.apps.get(f.id),
      st = app.state,
      now = Date.now();
    const immediate = this.immediate(f) && !this.guarded(f);
    const pending = this.s.pending.filter(
      (p) => p.frameId === f.id && !p.withdrawn && p.state !== 'bestaetigt',
    );
    const battery = st.battery;
    const forecast = batteryEstimate(
      (st.batteryLog || []).filter((p) => p.at >= (f.cadenceAppliedAt || 0)),
      f.activeCadence,
      now,
      (!!st.lightSleep && !st.lightSleep.endedAt) ||
        (!!st.playlist?.missed && !st.playlist.missed.resolvedAt),
    );
    const changes = st.playlist?.changes || [];
    const missed =
      f.missed ||
      changes.filter(
        (c) => !c.online && c.until < now && !st.playlist?.missed?.resolvedAt,
      ).length;
    const upcoming = this.timeline(f).find((e) => e.state !== 'haengt');
    const shortBy = Math.max(
      f.shortage || 0,
      this.getDeck(f.groupId, f.orientation).shortBy,
    );
    const health = f.prepareError
      ? { level: 'warn', title: 'Bilder vorbereiten', text: f.prepareError }
      : missed
        ? {
            level: 'bad',
            title: 'Wechsel verpasst',
            text: 'Knopf am Rahmen drücken, damit er einen frischen Vorrat bekommt.',
          }
        : f.power === 'akku' &&
            battery?.batteryPercent < 10 &&
            !battery?.pluggedIn
          ? {
              level: 'bad',
              title: 'Akku laden',
              text: `Zuletzt ${battery.batteryPercent} %. Bitte laden.`,
            }
          : shortBy
            ? {
                level: 'warn',
                title: 'Zu wenig Bilder',
                text: `Für einen vollen Vorrat fehlen ${shortBy} passende Bilder.`,
              }
            : {
                level: 'ok',
                title: 'In Ordnung',
                text: 'Der Zeitplan zeigt die erwarteten Bilder. Der Bildschirm selbst ist nicht überprüfbar.',
              };
    const nextChange = this.nextPlannedChange(f, now);
    const result = {
      id: f.id,
      name: f.name,
      device: f.device,
      ip: f.ip,
      orientation: f.orientation,
      upsideDown: !!f.upsideDown,
      groupId: f.groupId,
      tags: f.tags || [],
      power: f.power,
      charging: !!battery?.pluggedIn,
      health,
      battery:
        f.power === 'dauerstrom'
          ? null
          : battery
            ? {
                percent: battery.batteryPercent,
                at: battery.at,
                until: forecast?.until || null,
                changesLeft: forecast?.changesLeft ?? null,
                afterPending: null,
              }
            : null,
      current: f.current
        ? {
            pictureId: f.current.pictureId || null,
            since: f.current.since,
            unsure: true,
            card: f.current.card || null,
          }
        : { pictureId: null, since: 0, unsure: true, card: null },
      nextChange,
      nextOnline: {
        at: immediate ? now : nextChange,
        uncertain:
          !!missed ||
          (!battery && f.power === 'akku') ||
          (!!battery && battery.batteryPercent < 10),
        immediate,
      },
      lastOnline: {
        at: f.lastOnline || st.lastCheck?.at || f.delivered?.sentAt || 0,
        secondsAfterChange: changes.find((c) => c.online)
          ? Math.round(
              (changes.find((c) => c.online).online -
                changes.find((c) => c.online).at) /
                1000,
            )
          : null,
      },
      missedChanges: missed,
      justUpdated: this.guarded(f) ? { at: f.guard.at } : null,
      watching:
        pending.some((p) => ['eingestellt', 'wartet'].includes(p.state)) &&
        f.watch?.until > now &&
        !this.guarded(f) &&
        !this.immediate(f)
          ? { everySec: 5, until: f.watch.until }
          : null,
      cadence: {
        value: f.cadence,
        confirmedAt: null,
        ...(JSON.stringify(f.cadence) !== JSON.stringify(f.activeCadence)
          ? { deviceValue: f.activeCadence }
          : {}),
      },
      cleaning: {
        value: f.cleaning,
        confirmedAt:
          f.observedCleaning?.value === f.cleaning
            ? f.observedCleaning.at
            : st.cleaning?.hour !== undefined &&
                `${String(st.cleaning.hour).padStart(2, '0')}:${String(st.cleaning.minute).padStart(2, '0')}` ===
                  f.cleaning
              ? st.cleaning.goodAt || st.cleaning.readAt
              : null,
        ...(f.observedCleaning && f.observedCleaning.value !== f.cleaning
          ? { deviceValue: f.observedCleaning.value }
          : {}),
      },
      buffer: f.buffer,
      bufferLeft: (f.delivered?.entries || []).filter((e) => e.at > now).length,
      pendingCount: pending.length,
      eventId:
        this.eventsFor(f.id).find((e) => e.start <= now && e.end > now)?.id ||
        null,
      upNext: upcoming
        ? {
            pictureId: upcoming.pictureId,
            at: upcoming.at,
            state: upcoming.state,
            uncertain: true,
          }
        : null,
    };
    if (!detail) return result;
    const display = st.displayCheck,
      ls = st.lightSleep,
      clean = app.cleaningStatus();
    const deck = this.s.decks[`${f.groupId}:${f.orientation}`];
    return {
      ...result,
      batteryLog: st.batteryLog || [],
      delivery: f.delivered
        ? {
            sentAt: f.delivered.sentAt || f.delivered.builtAt,
            pictures: f.delivered.entries.length,
            endsAt: f.delivered.endsAt,
            usedUp: now >= f.delivered.endsAt,
          }
        : null,
      changes: changes.map((c) => ({
        at: c.at,
        onlineAfterSec: c.online ? Math.round((c.online - c.at) / 1000) : null,
        battery: c.battery ?? null,
      })),
      changeStats: {
        watched: changes.filter((c) => c.online || c.until < now).length,
        online: changes.filter((c) => c.online).length,
      },
      sleep: {
        mode: f.power === 'akku' ? 'tiefschlaf' : 'standby',
        asleep: !!st.sleep?.asleep,
        since: st.sleep?.sleptAt || null,
        onWifi: st.sleep?.network === 'on',
        bySelf: !!st.sleep?.self || !!st.sleep?.own,
      },
      lightSleep: ls
        ? {
            since: ls.since,
            until: ls.endedAt || null,
            tries: (ls.tries || []).map((t) => ({
              at: t.at,
              result: t.result || t.step || t.why || '',
            })),
            gaveUp: !!ls.gaveUp,
            batteryFrom: ls.batteryFrom ?? null,
            batteryTo: ls.batteryTo ?? null,
          }
        : null,
      deepSleepAttempt: st.deepSleep
        ? {
            at: st.deepSleep.at,
            result: st.deepSleep.step,
            ok: ['off the Wi-Fi', 'asleep'].includes(st.deepSleep.step),
          }
        : null,
      checks: {
        everyMin: app.cfg.sleep.checkMin,
        last: { at: st.lastCheck?.at || 0, awake: !!st.lastCheck?.awake },
        foundAwake: (st.wakeEvents || []).map((e) => ({
          at: e.at,
          battery: e.battery ?? null,
          charging: !!e.charging,
          note: e.sent
            ? 'Vorrat übertragen'
            : e.leftAlone
              ? 'In Ruhe gelassen'
              : e.error || 'Erreichbar',
        })),
      },
      cleaningWindow: {
        quietFrom: clean?.quietFrom
          ? new Date(clean.quietFrom).toLocaleTimeString('de-DE', {
              timeZone: f.timezone,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })
          : '',
        quietUntil: clean?.quietUntil
          ? new Date(clean.quietUntil).toLocaleTimeString('de-DE', {
              timeZone: f.timezone,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })
          : '',
        readAt: st.cleaning?.readAt || null,
      },
      deviceCheck: display
        ? {
            at: display.at,
            name: display.name || '',
            firmware: display.software || '',
            networkStandby: display.networkStandby || '',
            sleepAfter: display.sleepAfter || '',
            sleepAfterUpdate: display.applySleep || '',
            lowPowerWifi: display.lowPowerWifi || '',
          }
        : null,
      round: {
        n: deck?.round || 1,
        shown: deck?.shown.length || 0,
        total: deck?.order.length || 0,
      },
      lastProblem:
        f.lastProblem ||
        (st.lastError
          ? { at: st.lastError.at, text: st.lastError.message }
          : null),
      testPattern: st.testPattern ? { at: st.testPattern.at } : null,
      setupTest: f.setupTest || null,
    };
  }
  nextPlannedChange(f, now = Date.now()) {
    const delivered = f.delivered?.entries.find((e) => e.at > now)?.at;
    return delivered || this.clock(f).next(now);
  }
  getFrame(frameId) {
    return this.publicFrame(this.frame(frameId), true);
  }
  getOverview() {
    const frames = this.s.frames
      .filter((f) => !f.removed)
      .map((f) => this.publicFrame(f));
    const notes = [];
    if (!frames.length)
      notes.push({
        level: 'warn',
        text: 'Ersten Rahmen hinzufügen.',
        link: '/einstellungen/rahmen-neu',
      });
    if (
      this.s.programs.some(
        (p) => p.entries.some((e) => e.eventId) && p.state === 'downloaded',
      )
    )
      notes.push({
        level: 'warn',
        text: 'Events kehren im übertragenen Vorrat zurück. Ist er aufgebraucht, kann das Event erneut erscheinen.',
        link: '/events',
      });
    return {
      frames,
      groups: this.listGroups(),
      events: this.listEvents(),
      notes,
      inboxCount: this.listInbox().length,
      discardedCount: this.listDiscarded().length,
      at: Date.now(),
    };
  }
}
