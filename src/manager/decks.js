import crypto from 'node:crypto';
import { fail } from './store.js';
import { unsent } from './pending.js';

const RECENT_MS = 24 * 3600000;
export const fits = (p, orientation) =>
  p.alsoOther || p.orientation === orientation;
const shuffle = (items) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export class Decks {
  identities(pid, seen = new Set()) {
    const p = this.s.pictures.find((p) => p.id === pid);
    if (!p || seen.has(pid)) return [];
    seen.add(pid);
    return [
      ...new Set([
        p.identity || p.id,
        ...(p.combo?.memberIds.flatMap((id) => this.identities(id, seen)) ||
          []),
      ]),
    ];
  }
  owners(pid) {
    return [
      ...new Set(
        this.identities(pid).flatMap((i) =>
          Object.keys(this.s.claims[i] || {}),
        ),
      ),
    ];
  }
  reserve(pid, frameId, force = false) {
    if (!force && this.owners(pid).some((owner) => owner !== frameId))
      throw fail(
        'Bild hängt oder ist an einem anderen Rahmen vorgemerkt.',
        409,
      );
    for (const identity of this.identities(pid))
      (this.s.claims[identity] ||= {})[frameId] = true;
  }
  releaseUnused(frame, held) {
    // Only called after a complete successor download, never on timeout, expiry or a dead frame.
    held = [...held, ...this.s.pending
      .filter((p) => p.frameId === frame.id && !p.withdrawn &&
        (unsent(p) || p.applying) && p.payload.pictureIds)
      .flatMap((p) => p.payload.remaining || p.payload.pictureIds)];
    const identities = new Set(held.flatMap((pid) => this.identities(pid)));
    for (const [identity, owners] of Object.entries(this.s.claims)) {
      if (!identities.has(identity)) delete owners[frame.id];
      if (!Object.keys(owners).length) delete this.s.claims[identity];
    }
    // Never-shown reservations return to the front only after a successor is safe.
    for (const deck of Object.values(this.s.decks)) {
      const returned = (deck.dealt || []).filter(
        (pid) => !deck.shown.includes(pid) && !this.owners(pid).length,
      );
      deck.dealt = (deck.dealt || []).filter((pid) => !returned.includes(pid));
      deck.order = [
        ...returned,
        ...deck.order.filter((pid) => !returned.includes(pid)),
      ];
    }
  }
  eligible(group, orientation) {
    return this.s.pictures.filter(
      (p) =>
        p.status === 'accepted' &&
        !p.paused &&
        fits(p, orientation) &&
        (p.albums.some((a) => group.albums.includes(a)) ||
          (p.source === 'kunst' && group.art.every > 0)),
    );
  }
  syncDecks() {
    for (const g of this.s.groups)
      for (const o of ['hoch', 'quer']) {
        const key = `${g.id}:${o}`;
        const deck = (this.s.decks[key] ||= {
          order: [],
          shown: [],
          dealt: [],
          round: 1,
          draws: 0,
        });
        deck.dealt ||= [...deck.shown];
        const ids = this.eligible(g, o).map((p) => p.id);
        deck.order = [
          ...deck.order.filter((pid) => ids.includes(pid)),
          ...shuffle(ids.filter((pid) => !deck.order.includes(pid))),
        ];
        deck.shown = deck.shown.filter((pid) => ids.includes(pid));
        deck.dealt = deck.dealt.filter((pid) => ids.includes(pid));
      }
  }
  draw(frame, excluded = [], reorder = false) {
    const g = this.group(frame.groupId);
    const deck = this.s.decks[`${g.id}:${frame.orientation}`];
    if (!deck) return null;
    const usable = (pid) =>
      !excluded.some((x) =>
        this.identities(x).some((identity) =>
          this.identities(pid).includes(identity),
        ),
      ) &&
      !this.owners(pid).some((owner) => !reorder || owner !== frame.id) &&
      (!this.picture(pid).lastShown ||
        this.picture(pid).lastShown.frameId === frame.id ||
        Date.now() - this.picture(pid).lastShown.at >= RECENT_MS);
    let available = deck.order.filter((pid) => !deck.dealt.includes(pid) ||
      (reorder && this.owners(pid).includes(frame.id) && !deck.shown.includes(pid)));
    if (!available.length && deck.order.length) {
      deck.round++;
      deck.shown = [];
      deck.dealt = [];
      const recent = (pid) =>
        Number(Date.now() - (this.picture(pid).lastShown?.at || 0) < RECENT_MS);
      deck.order = shuffle(deck.order).sort((a, b) => recent(a) - recent(b));
      available = deck.order;
    }
    const artTurn = g.art.every && (deck.draws + 1) % g.art.every === 0;
    const pid =
      available.find(
        (pid) =>
          usable(pid) && (this.picture(pid).source === 'kunst') === !!artTurn,
      ) || available.find(usable);
    if (!pid) return null;
    this.reserve(pid, frame.id);
    deck.draws++;
    // Reservations are not 'shown'. Keep a separate dealt set in the round.
    deck.order = [...deck.order.filter((p) => p !== pid), pid];
    if (!deck.dealt.includes(pid)) deck.dealt.push(pid);
    return pid;
  }
  noteShown(pid, frameId, at) {
    const p = this.s.pictures.find((p) => p.id === pid);
    if (!p) return;
    p.lastShown = { frameId, at };
    for (const other of this.s.pictures)
      if (
        this.identities(other.id).some((i) => this.identities(pid).includes(i))
      ) {
        other.lastShown = { frameId, at };
        for (const deck of Object.values(this.s.decks))
          if (deck.order.includes(other.id)) {
            if (!deck.shown.includes(other.id)) deck.shown.push(other.id);
            if (!deck.dealt.includes(other.id)) deck.dealt.push(other.id);
          }
      }
  }
  where(p) {
    const ids = new Set(this.identities(p.id));
    const matches = (pid) =>
      pid && this.identities(pid).some((i) => ids.has(i));
    let hangs = null;
    let reserved = null;
    for (const f of this.s.frames.filter((f) => !f.removed)) {
      if (f.current && matches(f.current.pictureId))
        hangs ||= { frameId: f.id, since: f.current.since };
      const entry = [...(f.plan || []), ...(f.delivered?.entries || [])].find(
        (e) => matches(e.pictureId) && e.at > Date.now(),
      );
      if (entry) reserved ||= { frameId: f.id, at: entry.at };
    }
    if (!reserved && !hangs) {
      const owner = this.owners(p.id)[0];
      if (owner) reserved = { frameId: owner, at: Date.now() };
    }
    return {
      hangs,
      reserved,
      lastShown: p.lastShown || null,
      justShown:
        !!p.lastShown && Date.now() - p.lastShown.at < RECENT_MS && !hangs,
      shownThisRound: Object.values(this.s.decks).some((d) =>
        d.shown.includes(p.id),
      ),
    };
  }
  getDeck(groupId, orientation) {
    const group = this.group(groupId);
    const deck = this.s.decks[`${groupId}:${orientation}`];
    if (!deck) throw fail('Format nicht gefunden', 404);
    const cards = deck.order.map((pid) => {
      const where = this.where(this.picture(pid));
      const owned = where.hangs || where.reserved;
      const frame = owned && this.frame(owned.frameId, true);
      const entry =
        frame && this.timeline(frame).find((e) => e.pictureId === pid);
      const shared =
        frame &&
        [...(frame.plan || []), ...(frame.delivered?.entries || [])].find(
          (e) =>
            e.pictureId !== pid &&
            this.identities(e.pictureId).some((i) =>
              this.identities(pid).includes(i),
            ),
        );
      return {
        pictureId: pid,
        state: where.hangs
          ? 'haengt'
          : where.reserved
            ? 'vorgemerkt'
            : deck.shown.includes(pid)
              ? 'gezeigt'
              : 'stapel',
        frameId: owned?.frameId || null,
        expectedAt: where.reserved?.at || null,
        locked: !!where.hangs || !!entry?.locked || !!shared,
        sharedWith: shared?.pictureId || null,
      };
    });
    const need = this.s.frames
      .filter(
        (f) =>
          !f.removed && f.groupId === group.id && f.orientation === orientation,
      )
      .reduce((n, f) => n + f.buffer + 1, 0);
    return {
      groupId,
      orientation,
      cards,
      shortBy: Math.max(0, need - cards.length),
    };
  }
  moveDeckCard(groupId, orientation, pictureId, toIndex) {
    const card = this.getDeck(groupId, orientation).cards.find(
      (c) => c.pictureId === pictureId,
    );
    if (!card || card.locked) throw fail('Dieses Bild ist gesperrt.', 409);
    const deck = this.s.decks[`${groupId}:${orientation}`];
    const order = deck.order.filter((pid) => pid !== pictureId);
    order.splice(
      Math.max(0, Math.min(order.length, Number(toIndex) || 0)),
      0,
      pictureId,
    );
    deck.order = order;
    for (const f of this.s.frames.filter(
      (f) =>
        !f.removed && f.groupId === groupId && f.orientation === orientation,
    ))
      this.queue(f, 'reihenfolge', 'Reihenfolge im Stapel geändert', {
        deck: true,
        reorderAt: this.timeline(f).find((e) => !e.locked)?.at,
      });
    this.save();
  }
  timeline(f) {
    const now = Date.now();
    const current = f.current?.pictureId
      ? [
          {
            pictureId: f.current.pictureId,
            at: f.current.since,
            state: 'haengt',
            eventId: null,
            pinned: false,
            locked: true,
            change: null,
          },
        ]
      : [];
    const delivered = f.delivered?.entries || [];
    let upcoming = (f.plan?.length ? f.plan : delivered).filter(
      (e) => e.at > now,
    );
    const immediate = this.immediate(f);
    const next = delivered.find((e) => e.at > now);
    if (!immediate && next)
      upcoming = [next, ...upcoming.filter((e) => e.at > next.at)];
    return [
      ...current,
      ...upcoming.map((e, i) => ({
        pictureId: e.pictureId,
        at: e.at,
        eventId: e.eventId || null,
        pinned: !!e.pinned,
        state: delivered.some(
          (x) => x.pictureId === e.pictureId && x.at === e.at,
        )
          ? 'am-rahmen'
          : 'wartet',
        locked:
          !!e.eventId ||
          (!immediate &&
            i === 0 &&
            delivered.some(
              (x) => x.pictureId === e.pictureId && x.at === e.at,
            )),
        change: e.changeId
          ? this.s.pending.find((p) => p.id === e.changeId)?.state || null
          : null,
      })),
    ];
  }
  moveTimelineItem(frameId, pictureId, toIndex) {
    const f = this.frame(frameId);
    const timeline = this.timeline(f);
    const entry = timeline.find((e) => e.pictureId === pictureId);
    if (!entry || entry.locked)
      throw fail(
        'Das aktuelle und das nächste Bild im Tiefschlaf sind gesperrt.',
        409,
      );
    const order = timeline
      .filter((e) => !e.locked && e.pictureId !== pictureId)
      .map((e) => e.pictureId);
    order.splice(
      Math.max(0, Math.min(order.length, Number(toIndex) || 0)),
      0,
      pictureId,
    );
    this.queue(f, 'reihenfolge', 'Reihenfolge am Rahmen geändert', {
      order,
      reorderAt: timeline.find((e) => !e.locked)?.at,
    });
    this.save();
  }
}
