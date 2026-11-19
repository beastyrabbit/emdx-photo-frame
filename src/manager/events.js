import { id, fail } from './store.js';
import { fits } from './decks.js';

export class Events {
  eventAssignments(draft) {
    const assigned = Object.fromEntries(draft.frameIds.map((fid) => [fid, []]));
    if (draft.sameOnAll) {
      for (const fid of draft.frameIds)
        assigned[fid] = draft.pictureIds.filter((pid) =>
          fits(this.picture(pid), this.frame(fid).orientation),
        );
      return assigned;
    }
    const used = new Set();
    for (const pid of draft.pictureIds) {
      if (this.identities(pid).some((i) => used.has(i))) continue;
      const owners = this.owners(pid);
      const candidates = draft.frameIds.filter(
        (fid) =>
          fits(this.picture(pid), this.frame(fid).orientation) &&
          !owners.some((owner) => owner !== fid),
      );
      candidates.sort((a, b) => assigned[a].length - assigned[b].length);
      if (!candidates.length) continue;
      assigned[candidates[0]].push(pid);
      for (const i of this.identities(pid)) used.add(i);
    }
    return assigned;
  }
  eventsFor(frameId) {
    return this.s.events.filter(
      (e) => !e.deleted && e.frameIds.includes(frameId),
    );
  }
  listEvents() {
    const now = Date.now();
    return this.s.events
      .filter((e) => !e.deleted)
      .map((e) => ({
        ...e,
        state: now >= e.end ? 'vorbei' : now < e.start ? 'geplant' : 'laeuft',
      }));
  }
  estimateEvent(draft) {
    this.validateEvent(draft);
    const assignment = this.eventAssignments(draft);
    return {
      perFrame: draft.frameIds.map((frameId) => {
        const f = this.frame(frameId),
          now = Date.now();
        const changes = Math.ceil(
          (draft.end - Math.max(draft.start, now)) / (draft.everyMin * 60000),
        );
        const normal = Math.max(
          0,
          Math.floor(
            (draft.end - draft.start) / (f.activeCadence.everyMin * 60000),
          ),
        );
        const extraBattery = this.immediate(f)
          ? null
          : Math.max(0, changes - normal) * 1.75;
        const battery = this.apps.get(f.id).state.battery;
        return {
          frameId,
          changes,
          extraBattery,
          batteryAfter:
            battery && extraBattery !== null
              ? Math.max(0, battery.batteryPercent - extraBattery)
              : null,
          pressReason:
            f.missed || battery?.batteryPercent < 10
              ? 'verpasst'
              : this.nextOnline(f) > draft.start
                ? 'zu-spaet'
                : null,
          nextContact: this.immediate(f) ? null : this.nextOnline(f),
          missingFormat: !assignment[frameId]?.length,
          overlapsWith:
            this.eventsFor(f.id).find(
              (e) =>
                e.id !== draft.id && e.start < draft.end && e.end > draft.start,
            )?.id || null,
        };
      }),
      repeats:
        Math.ceil((draft.end - draft.start) / (draft.everyMin * 60000)) >
        draft.pictureIds.length,
      batteryBasis:
        'Planungsbereich 1–2,5 % pro zusätzlichem Bildaufbau; keine Messung',
      offlineFallback:
        'Rückkehr ist im Vorrat enthalten. Ein aufgebrauchter Vorrat kann das Event später wiederholen.',
    };
  }
  validateEvent(draft) {
    if (
      !draft?.name?.trim() ||
      draft.name.length > 100 ||
      !Number.isFinite(draft.start) ||
      !Number.isFinite(draft.end) ||
      draft.end <= draft.start ||
      !Number.isInteger(draft.everyMin) ||
      draft.everyMin < 1 ||
      !Array.isArray(draft.frameIds) ||
      !draft.frameIds.length ||
      !Array.isArray(draft.pictureIds) ||
      !draft.pictureIds.length
    )
      throw fail('Event-Angaben prüfen');
    if ((draft.end - draft.start) / (draft.everyMin * 60000) > 240)
      throw fail('Höchstens 240 Event-Wechsel pro Vorrat');
    for (const frameId of draft.frameIds) this.frame(frameId);
    for (const pid of draft.pictureIds)
      if (this.picture(pid).status !== 'accepted')
        throw fail('Event-Bilder erst übernehmen');
    // Reject an unbuildable Event before persisting it or taking reservations.
    const now = Date.now();
    for (const fid of draft.frameIds)
      this.programSchedule(this.frame(fid), [
        ...this.eventsFor(fid).filter((e) => e.id !== draft.id && e.end > now),
        ...(draft.end > now ? [draft] : []),
      ], now);
  }
  saveEvent(draft) {
    const estimate = this.estimateEvent(draft);
    if (estimate.perFrame.some((f) => f.missingFormat || f.overlapsWith))
      throw fail('Event überschneidet sich oder ein Bildformat fehlt.', 409);
    const event = draft.id
      ? this.s.events.find((e) => e.id === draft.id && !e.deleted)
      : { id: id() };
    if (!event) throw fail('Event nicht gefunden', 404);
    const before = draft.id ? structuredClone(event) : null;
    const eventChangeId = id();
    const oldFrames = event.frameIds || [];
    Object.assign(event, {
      name: draft.name,
      start: draft.start,
      end: draft.end,
      everyMin: draft.everyMin,
      frameIds: [...new Set(draft.frameIds)],
      pictureIds: [...draft.pictureIds],
      sameOnAll: draft.sameOnAll === true,
    });
    if (!draft.id) this.s.events.push(event);
    const assignment = this.eventAssignments(event);
    for (const [fid, pictures] of Object.entries(assignment))
      for (const pid of pictures) this.reserve(pid, fid, event.sameOnAll);
    for (const frameId of new Set([...oldFrames, ...event.frameIds])) {
      const f = this.frame(frameId);
      this.queue(
        f,
        'event',
        `Event ${event.name}`,
        { eventId: event.id, snapshot: structuredClone(event) },
        { before, eventChangeId },
      );
      this.requestPrepare(f);
    }
    this.record({
      kind: 'event',
      eventId: event.id,
      text: `Event ${event.name} eingestellt. Rückkehr zum normalen Rhythmus im Vorrat; nach dessen Ende kann er sich wiederholen.`,
    });
    this.save();
    return { id: event.id };
  }
  endEvent(eventId) {
    const event = this.s.events.find((e) => e.id === eventId && !e.deleted);
    if (!event) throw fail('Event nicht gefunden', 404);
    const before = structuredClone(event),
      eventChangeId = id();
    event.end = Math.min(event.end, Date.now());
    for (const frameId of event.frameIds) {
      const f = this.frame(frameId);
      this.queue(
        f,
        'event',
        `Event ${event.name} beenden`,
        { eventId, snapshot: structuredClone(event) },
        { before, eventChangeId },
      );
      this.requestPrepare(f);
    }
    this.save();
  }
  deleteEvent(eventId) {
    const event = this.s.events.find((e) => e.id === eventId && !e.deleted);
    if (!event) throw fail('Event nicht gefunden', 404);
    this.endEvent(eventId);
    event.deleted = true;
    this.save();
  }
}
