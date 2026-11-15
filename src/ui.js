// The status page served at http://<nas>:<HTTP_PORT>/
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Photo frame</title>
<style>
  :root { --bg:#f6f5f2; --card:#fff; --ink:#1d1f22; --muted:#6b6f76; --line:#e3e1dc; --accent:#2f5d50; --on-accent:#fff; --warn:#a33a2c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16181b; --card:#1f2226; --ink:#e9e7e2; --muted:#9aa0a6; --line:#2e3238; --accent:#7fb8a4; --on-accent:#0f1c18; --warn:#e07a6a; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--ink); }
  main { max-width:1100px; margin:0 auto; padding:24px 16px 48px; display:grid; gap:20px; grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
  header { grid-column:1/-1; display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
  h1 { font-size:22px; margin:0; font-weight:650; }
  .chip { font-size:13px; padding:2px 10px; border-radius:99px; border:1px solid var(--line); color:var(--muted); }
  .chip.busy { color:var(--accent); border-color:var(--accent); }
  nav { display:flex; gap:6px; flex-wrap:wrap; margin-left:auto; }
  nav a { font-size:14px; padding:4px 12px; border-radius:99px; border:1px solid var(--line); color:var(--ink); text-decoration:none; }
  nav a.on { border-color:var(--accent); color:var(--accent); font-weight:600; }
  nav a i, #health i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:7px; background:var(--accent); }
  nav a i.warn, #health.warn i { background:#c98a1b; } nav a i.bad, #health.bad i { background:var(--warn); }
  #health { grid-column:1/-1; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:10px 14px; }
  #health.bad { border-color:var(--warn); color:var(--warn); font-weight:600; }
  .frame { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; }
  .frame img { width:100%; height:auto; display:block; border-radius:4px; background:#ccc; }
  .tabs { display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; }
  .tabs button, .actions button, #gen button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--ink); border-radius:8px; padding:6px 12px; cursor:pointer; }
  .tabs button.on { border-color:var(--accent); color:var(--accent); }
  .actions { display:flex; gap:8px; flex-wrap:wrap; }
  .actions button.primary, #gen button.primary { background:var(--accent); border-color:var(--accent); color:var(--on-accent); font-weight:600; }
  .actions button:disabled, #gen button:disabled { opacity:.5; cursor:default; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; display:grid; gap:14px; align-content:start; align-self:start; }
  dl { margin:0; display:grid; grid-template-columns:auto 1fr; gap:6px 14px; }
  dt { color:var(--muted); } dd { margin:0; overflow-wrap:anywhere; }
  .err { color:var(--warn); }
  .muted { color:var(--muted); font-size:13px; }
  #sources { display:grid; gap:8px; grid-template-columns:1fr 1fr; }
  #sources img { width:100%; border-radius:4px; }
  .slots { display:grid; gap:10px; grid-template-columns:repeat(auto-fill, minmax(76px, 1fr)); }
  .slots figure { margin:0; }
  .slots img { width:100%; display:block; border-radius:4px; background:#ccc; }
  .slots figure.now img { outline:3px solid var(--accent); outline-offset:2px; }
  .slots figcaption { font-size:12px; color:var(--muted); margin-top:5px; }
  .slots figure.now figcaption { color:var(--accent); font-weight:600; }
  #gen { display:grid; gap:12px; }
  #gen[hidden] { display:none; }
  #gen textarea, #gen select { font:inherit; color:var(--ink); background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
  #gen textarea { width:100%; resize:vertical; min-height:76px; }
  #gen .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  #gallery { display:grid; gap:14px; }
  #gallery article { display:grid; grid-template-columns:96px minmax(0,1fr); gap:12px; align-items:start; border-top:1px solid var(--line); padding-top:14px; }
  #gallery img, #gallery .wait { width:96px; border-radius:4px; display:block; background:#ccc; }
  #gallery .wait { aspect-ratio:9/16; background:var(--line); animation:pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity:.45; } }
  @media (prefers-reduced-motion: reduce) { #gallery .wait { animation:none; } }
  #gallery .prompt { overflow-wrap:anywhere; }
  #gallery .row { margin-top:8px; }
  #gallery label { font-size:14px; display:inline-flex; gap:6px; align-items:center; cursor:pointer; }
  #gallery .on { color:var(--accent); font-weight:600; }
  a { color:var(--accent); }
  @media (max-width:760px) { main { grid-template-columns:1fr; } }
</style>
</head>
<body>
<main>
  <header><h1 id="title">Photo frame</h1><span id="state" class="chip">…</span><nav id="frames" hidden></nav></header>
  <div id="health" hidden></div>
  <section class="frame">
    <div class="tabs">
      <button data-view="preview" class="on">Preview</button>
      <button data-view="sources">Original photos</button>
      <button data-view="playlist" hidden>Playlist</button>
      <button data-view="test">Test pattern</button>
      <button data-view="generate">Generate</button>
    </div>
    <div id="view"></div>
    <div id="gen" hidden>
      <form id="genform">
        <textarea id="prompt" maxlength="1500" placeholder="Describe a picture: a heron in a misty polder at dawn, one red rowing boat" aria-label="Describe the picture"></textarea>
        <div class="row" style="margin-top:10px">
          <label>Style <select id="style"></select></label>
          <button class="primary" id="genbtn">Generate</button>
          <span class="muted" id="genusage"></span>
        </div>
      </form>
      <div class="err" id="generr"></div>
      <div id="gallery"></div>
    </div>
    <p class="muted" id="viewnote"></p>
  </section>
  <section class="card">
    <div class="actions">
      <button class="primary" data-act="next">Next photo now</button>
      <button data-act="resend">Send again</button>
      <button data-act="test-pattern">Show test pattern</button>
      <button data-act="refresh-album">Re-read album</button>
      <button data-act="display-info" title="Wakes the display (if Wake-on-LAN reaches it) and reads its battery and settings">Check display</button>
      <button data-act="deep-sleep" hidden title="Sends the display into deep sleep the way the Samsung app does (its deep sleep mode setting again, then its Sleep button), then checks that it drops off the Wi-Fi">Deep sleep now</button>
    </div>
    <dl id="info"></dl>
    <div id="error" class="err"></div>
    <div><strong>Recent</strong><dl id="history" style="margin-top:8px"></dl></div>
  </section>
</main>
<script>
let view = 'preview', last = null;
// A tab has its own address (…/#generate), to bookmark it or come back to it.
const showTab = (name) => { view = name; document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.view === name)); };
// Several frames: ?frame=<id> says which one this page is about (default: the first).
const frame = new URLSearchParams(location.search).get('frame');
const u = (path) => frame ? path + (path.includes('?') ? '&' : '?') + 'frame=' + encodeURIComponent(frame) : path;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const fmt = (t) => t ? new Date(t).toLocaleString([], { dateStyle:'medium', timeStyle:'short' }) : '–';
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (t) => t ? new Date(t).toLocaleDateString([], { dateStyle:'long' }) : 'unknown date';
// A photo goes by the day it was taken, a picture made from a prompt by its prompt.
const what = (it) => it.title ? '“' + it.title + '”' : day(it.takenAt);
let galleryKey = '';
// The Generate tab. Its form stays as it is between refreshes (someone may be typing in it);
// the gallery is redrawn only when something in it changed.
function renderGen(s) {
  const g = s.generate || { items: [], styles: [], usage: {} };
  const sel = $('#style');
  if (!sel.options.length && g.styles.length) { sel.innerHTML = g.styles.map((o) => '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>').join(''); sel.value = g.style || 'none'; }
  $('#genbtn').disabled = !g.enabled || !!g.busy;
  $('#genbtn').textContent = g.busy ? 'Generating…' : 'Generate';
  $('#genusage').textContent = g.enabled ? g.usage.count + ' of ' + g.usage.max + ' today' : '';
  $('#generr').textContent = !g.enabled ? '' : g.error && !g.busy ? 'No picture (' + fmt(g.error.at) + '): ' + g.error.message : '';
  const pl = s.playlist, deep = s.sleep && s.sleep.mode === 'deep';
  const showTitle = pl && deep ? 'Now if the display is awake (press its power button first); otherwise at its next change. For one day.'
    : pl ? 'Replaces the photo for now, for one day' : 'Sends it to the display now';
  const blocked = !!s.busy && !s.busy.probe;
  const key = JSON.stringify([g.items, g.busy && g.busy.prompt, blocked, showTitle]);
  if (key !== galleryKey) {
    galleryKey = key;
    const wait = g.busy ? '<article><div class="wait"></div><div><div class="prompt">' + esc(g.busy.prompt) + '</div><div class="muted">Google is drawing it; this takes half a minute or so…</div></div></article>' : '';
    $('#gallery').innerHTML = wait + g.items.map((it) => {
      const on = !it.on ? '' : it.on.where === 'frame' ? 'On the frame' : it.on.where === 'planned' ? 'On the frame from ' + it.on.label : 'Goes on the frame when the display is next online';
      return '<article data-id="' + esc(it.id) + '"><a href="' + u('/img/art/' + it.id + '/preview.png') + '" target="_blank"><img loading="lazy" src="' + u('/img/art/' + it.id + '/thumb.jpg') + '" alt=""></a><div>'
        + '<div class="prompt">' + esc(it.prompt) + '</div>'
        + '<div class="muted">' + esc((it.style ? it.style + ' · ' : '') + fmt(it.createdAt)) + (on ? ' · <span class="on">' + esc(on) + '</span>' : '') + '</div>'
        + '<div class="row"><button data-art="show" title="' + esc(showTitle) + '"' + (blocked ? ' disabled' : '') + '>Show on the frame</button>'
        + '<label title="Adds it to the photos the frame picks from: it comes up once per round of the album"><input type="checkbox" data-art="keep"' + (it.keep ? ' checked' : '') + '> Keep in rotation</label>'
        + '<button data-art="reuse" title="Puts this description back in the box above">Reuse prompt</button>'
        + '<button data-art="delete">Delete</button></div></div></article>';
    }).join('');
  }
  return g.enabled
    ? 'Pictures are made by Google (' + (g.model || 'Gemini') + ') from your description; each one costs a few cents. The preview shows a picture as it goes to the display. Click for full size.'
    : (g.why || '');
}
function renderView(s) {
  const v = Date.now();
  let html = '', note = '';
  $('#gen').hidden = view !== 'generate';
  $('#view').hidden = view === 'generate';
  if (view === 'generate') { $('#viewnote').textContent = renderGen(s); return; }
  if (view === 'preview') {
    if (s.current) { html = '<a href="' + u('/img/current/preview.png?' + v) + '" target="_blank"><img src="' + u('/img/current/preview.jpg?' + s.current.renderedAt) + '" alt="preview"></a>';
      note = s.dither === 'device'
        ? 'The photo as sent. The display dithers it itself, so on the panel the colours look softer. Click for full size.'
        : 'Simulated with the measured ink colours as your eye sees them, from a distance. Click for the full-size dither.'; }
    else html = '<p class="muted">Nothing rendered yet.</p>';
  } else if (view === 'sources') {
    if (s.current) html = '<div id="sources">' + s.current.items.map((it, i) => '<img src="' + u('/img/current/source-' + (i+1) + '.jpg?' + s.current.renderedAt) + '" alt="">').join('') + '</div>';
  } else if (view === 'playlist') {
    const pl = s.playlist;
    if (!pl || !pl.slots.length) html = '<p class="muted">Preparing the photos…</p>';
    else {
      html = '<div class="slots">' + pl.slots.map((x) => '<figure class="' + (x.now ? 'now' : '') + '"><a href="' + u('/img/playlist/' + x.dir + '/preview.png') + '" target="_blank">'
        + '<img loading="lazy" src="' + u('/img/playlist/' + x.dir + '/thumb.jpg') + '" data-fallback="' + u('/img/playlist/' + x.dir + '/preview.jpg') + '" onerror="this.onerror=null;this.src=this.dataset.fallback" alt=""></a><figcaption>' + esc(x.label) + (x.now ? ' · now' : '')
        + (x.sent ? '' : ' · not sent yet') + '</figcaption></figure>').join('') + '</div>';
      note = 'One photo per change, from the one for now. The display changes to the next one by itself; the outlined one should be on the frame now. Click for full size.';
    }
  } else {
    html = s.testPattern ? '<img src="' + u('/img/testpattern/preview.png?' + s.testPattern.at) + '" alt="test pattern">' : '<p class="muted">Press “Show test pattern” to send one.</p>';
    note = 'Use it once to check orientation (TOP at the top), colours and whether the display re-processes the image.';
  }
  $('#view').innerHTML = html; $('#viewnote').textContent = note;
}
function batteryHtml(s) {
  const b = s.battery;
  if (!b) return '–';
  let h = esc(b.batteryPercent + '%' + (b.pluggedIn ? ' (charging)' : '') + ' · ' + fmt(b.at));
  if (b.batteryPercent < 20 && !b.pluggedIn) h += ' · <span class="err">low: charge the display</span>';
  const days = s.batteryDays || [];
  if (days.length > 1) h += '<br><span class="muted">' + esc('Per day: ' + days.map((d) => d.day + ' ' + d.percent + '%' + (d.charging ? ' (charging)' : '')).join(' · ')) + '</span>';
  return h;
}
function sleepHtml(s) {
  const z = s.sleep;
  if (!z) return '–';
  if (z.mode === 'off') return 'sleeps by its own settings (SLEEP_MODE=off)';
  if (z.asleep) {
    const since = z.sleptAt ? ' since ' + fmt(z.sleptAt) : '';
    // Asleep, yet still on the Wi-Fi in deep sleep mode (or off it in standby mode): say so.
    if (z.mode === 'deep' && z.network === 'on') return '<span class="err">' + esc('asleep' + since + ', but still on the Wi-Fi: a light sleep, which costs about 1.5% battery an hour') + '</span>';
    if (z.mode === 'standby' && z.network === 'off') return '<span class="err">' + esc('asleep' + since + ' and off the Wi-Fi: Wake-on-LAN no longer reaches it') + '</span>';
    const how = z.self ? ' (went to sleep by itself)' : z.confirmedAfter != null ? ' (confirmed)' : '';
    const where = z.mode === 'deep' && z.network === 'off' ? ', off the Wi-Fi' : '';
    const next = s.playlist ? ', changes the photo by itself' : z.mode === 'deep' ? '' : ', the next update wakes it';
    return esc((z.mode === 'deep' ? 'in deep sleep' : 'asleep') + since + how + where + next);
  }
  if (z.error) return '<span class="err">' + esc(z.error) + '</span>';
  if (z.pending && z.sleepAt) return esc('awake, goes to sleep at ' + hm(z.sleepAt));
  if (z.own) return 'awake, goes to sleep by itself';
  return 'awake';
}
// A light sleep the NAS noticed (asleep, but on the Wi-Fi at several checks in a row), and what
// it did about it. A finished one shows for a day.
function lightSleepHtml(ls) {
  if (!ls || !ls.strikes) return '';
  const end = ls.endedAt || ls.lastSeen;
  if (ls.endedAt && Date.now() - ls.endedAt > 86400000) return '';
  const tries = (ls.tries || []).map((t) => hm(t.at) + ' ' + t.how + ': ' + t.result).join('; ');
  let text = 'On the Wi-Fi while asleep (a light sleep) ' + fmt(ls.since) + ' to ' + (ls.endedAt ? hm(end) : 'now');
  if (tries) text += '. ' + tries;
  let bad = !ls.endedAt;
  if (ls.endedAt) text += '. Off the Wi-Fi again ' + fmt(ls.endedAt) + '.';
  else if (ls.charging) { text += '. On the charger, so left alone.'; bad = false; }
  else if (ls.gaveUp) text += '. The NAS could not get it into deep sleep: press its power button and leave it alone; if it stays on the Wi-Fi, restart it (hold the power button until the screen goes white, then switch it on).';
  else if (!tries) text += ' (' + ls.strikes + (ls.strikes === 1 ? ' check' : ' checks') + '): the NAS puts it into deep sleep if it stays that way.';
  return '<br><span class="' + (bad ? 'err' : 'muted') + '">' + esc(text) + '</span>';
}
// The last "Deep sleep now", step by step.
function deepSleepHtml(d) {
  if (!d) return '';
  // (One the NAS sent for a light sleep shows there once it is over.)
  if (d.why === 'light sleep' && !['sending', 'sent', 'asleep'].includes(d.step)) return '';
  const head = (d.why === 'light sleep' ? 'Deep sleep (the NAS, for a light sleep) ' : 'Deep sleep now ') + fmt(d.at) + ': ';
  const asleep = d.asleepAfter != null ? 'asleep after ' + d.asleepAfter + ' s' : '';
  let text;
  let bad = false;
  if (d.step === 'sending') text = 'waking it and sending the command…';
  else if (d.step === 'sent') text = 'sent; waiting for it to stop answering…';
  else if (d.step === 'asleep') text = asleep + '; is it off the Wi-Fi?…';
  else if (d.step === 'off the Wi-Fi') text = asleep + ', off the Wi-Fi after ' + d.offAfter + ' s: deep sleep';
  else if (d.step === 'still on the Wi-Fi') { text = asleep + ', but still on the Wi-Fi at ' + hm(d.checkedAt) + ': a light sleep'; bad = true; }
  else if (d.step === 'asleep (Wi-Fi unknown)') text = asleep + '; whether it left the Wi-Fi is unknown';
  else if (d.step === 'awake again') text = asleep + '; awake again after ' + d.awakeAfter + ' s';
  else if (d.step === 'not reached') text = 'no answer, not even to Wake-on-LAN (in deep sleep already?)';
  else if (d.step === 'charging') text = 'on the charger, so left alone';
  else if (d.step === 'still awake') { text = 'it took the command but stayed awake'; bad = true; }
  else { text = d.error || d.step; bad = true; }
  return '<br><span class="' + (bad ? 'err' : 'muted') + '">' + esc(head + text) + '</span>';
}
// Sleep checks, and when the display was found awake (after a press on its button, while
// charging). Waking up after a change is expected in playlist mode: that is under "After a change".
function watchHtml(c) {
  if (!c) return '–';
  let h = esc('every ' + c.everyMin + ' min');
  if (c.last) h += ' · last ' + esc(fmt(c.last.at)) + ': ' + (c.last.awake ? 'awake' : 'asleep');
  if (c.missedEverySec) h += '<br>' + esc('Looking for the display every ' + (c.missedEverySec >= 60 ? Math.round(c.missedEverySec / 60) + ' min' : c.missedEverySec + ' s') + ' (it missed a change)');
  const ev = (c.wakeEvents || []).filter((e) => !e.afterChange);
  if (ev.length) {
    h += '<br><span class="muted">Found awake:</span> ' + ev.slice(0, 4).map((e) => esc(fmt(e.at)
      + (e.afterMiss ? ' after a missed change' : '')
      + (e.battery != null ? ' (' + e.battery + '%' + (e.charging ? ', charging' : '') + ')' : '')
      + (e.sent === 'playlist' ? ', sent the playlist' : e.sent ? ', sent the waiting photo' : e.putBack ? ', put back to sleep' : e.leftAlone ? ', left to go back to sleep by itself' : e.error ? ', ' + e.error : ''))).join('; ');
  }
  return h;
}
function checkText(s) {
  const c = s.displayCheck;
  if (!c) return '–';
  return esc(fmt(c.at) + ' · ' + c.name + ', firmware ' + c.software + ' · Network Standby ' + c.networkStandby
    + (c.sleepAfter ? ' · Sleep After ' + c.sleepAfter : '') + (c.applySleep ? ' · sleep after content update ' + c.applySleep : '')
    + (c.lowPowerWifi ? ' · low-power Wi-Fi module ' + c.lowPowerWifi : '')
    + (c.cleaning && c.cleaning.hour != null ? ' · panel cleaning ' + String(c.cleaning.hour).padStart(2, '0') + ':' + String(c.cleaning.minute).padStart(2, '0') : ''));
}
// The display's daily panel cleaning, and the hands-off window the NAS keeps around it.
function cleaningHtml(cl) {
  if (!cl) return '<span class="muted">not known yet: the NAS reads it from the display the next time it talks to it</span>';
  if (!cl.time) return '<span class="muted">' + esc('unknown: the display did not say (' + cl.error + '). Set CLEANING_TIME (e.g. 05:50) to the time in the Samsung app.') + '</span>';
  return esc('daily at ' + cl.time + (cl.source === 'setting' ? ' (CLEANING_TIME)' : ' (read from the display ' + fmt(cl.readAt) + ')')
    + ' · the NAS leaves the display alone from ' + hm(cl.quietFrom) + ' to ' + hm(cl.quietUntil));
}
function playlistHtml(pl) {
  let h = pl.batch
    ? esc(pl.batch.photos + ' photos sent ' + fmt(pl.batch.sentAt) + ', until ' + fmt(pl.batch.endsAt) + ' (' + pl.daysLeft + ' to come; a fresh one '
      + (pl.resend === 'every-change' ? 'after every change' : 'when fewer than ' + pl.topUpDays + ' are left') + ')')
      + (pl.batch.ranOut ? ' · <span class="err">used up: the display repeats it until it gets a fresh one</span>' : '')
    : '<span class="err">not on the display yet</span>';
  if (pl.due) h += '<br><span class="muted">' + esc('Fresh playlist due (' + pl.due + '). It goes out when the display is next online (after its next change, or press its power button).') + '</span>';
  return h;
}
function changesHtml(pl) {
  const rows = (pl.changes || []).slice(0, 3).map((c) => {
    const bat = c.battery != null ? ', battery ' + c.battery + '%' : '';
    if (c.online) return esc(fmt(c.at) + ': online ' + Math.round((c.online - c.at) / 1000) + ' s after the change' + bat);
    if (c.until > Date.now()) return esc(fmt(c.at) + ': looking for the display until ' + hm(c.until) + '…');
    const m = pl.missed && pl.missed.key === c.key ? pl.missed : null;
    if (m && m.resolvedAt) return esc(fmt(c.at) + ': the display did not come online; back ' + fmt(m.resolvedAt) + ' (' + m.how + ')');
    if (c === pl.changes[0] && pl.batch && pl.batch.sentAt > c.until) return esc(fmt(c.at) + ': the display did not come online; a fresh playlist went out ' + fmt(pl.batch.sentAt));
    if (c === pl.changes[0]) return '<span class="err">' + esc(fmt(c.at) + ': the display did not come online, so it probably didn’t change the photo (asleep through it? stuck in its panel cleaning?). Press its power button: the NAS looks for it every minute and sends it a fresh playlist by itself.') + '</span>';
    return esc(fmt(c.at) + ': the display did not come online');
  });
  const st = pl.changeStats;
  if (st && st.watched > 1) rows.push('<span class="muted">' + esc('The display came online after ' + st.online + ' of the last ' + st.watched + ' changes.') + '</span>');
  return rows.length ? rows.join('<br>') : '–';
}
function render(s) {
  last = s;
  const name = s.frame && s.frame.name || 'Photo frame';
  $('#title').textContent = name; document.title = name;
  const fr = s.frames || [];
  $('#frames').hidden = fr.length < 2;
  $('#frames').innerHTML = fr.map((f) => '<a href="?frame=' + encodeURIComponent(f.id) + '" class="' + (s.frame && f.id === s.frame.id ? 'on' : '') + '" title="' + esc(f.health ? f.health.text : '') + '"><i class="' + esc(f.health ? f.health.level : '') + '"></i>' + esc(f.name) + '</a>').join('');
  const hl = s.health;
  $('#health').hidden = !hl;
  if (hl) { $('#health').className = hl.level; $('#health').innerHTML = '<i></i>' + esc(hl.text); }
  $('#state').textContent = s.busy ? s.busy.what + '…' : 'idle';
  $('#state').className = 'chip' + (s.busy ? ' busy' : '');
  // (A quick look at the display doesn't block the buttons: they wait for it.)
  document.querySelectorAll('.actions button').forEach((b) => b.disabled = !!s.busy && !s.busy.probe);
  const pl = s.playlist;
  $('[data-act="next"]').textContent = pl ? 'New photo for today' : 'Next photo now';
  $('[data-act="next"]').title = pl ? 'Replaces the photo for now and sends the playlist again' : '';
  $('[data-act="resend"]').textContent = pl ? 'Send playlist' : 'Send again';
  $('[data-act="resend"]').title = pl ? 'Sends the photos for the coming days now (the display must be awake: press its power button first)' : '';
  $('[data-view="playlist"]').hidden = !pl;
  $('[data-act="deep-sleep"]').hidden = !(s.sleep && s.sleep.mode === 'deep');
  const c = s.current;
  const tpShowing = s.testPattern && s.testPattern.sent && (!c || !c.pushedAt || s.testPattern.at > c.pushedAt);
  let onFrame = tpShowing ? 'the test pattern (until the next ' + (pl ? 'playlist' : 'update') + ')'
    : c ? esc(c.items.map(what).join(' + ')) + (c.dryRun ? ' <span class="muted">(dry run: EMDX_HOST not set)</span>' : c.pushed ? '' : ' <span class="err">(not on the display yet)</span>') : '–';
  if (pl && c && c.since && !tpShowing && c.pushed) onFrame += esc(' · since ' + fmt(c.since) + (c.byDisplay ? ', changed by the display' : ''));
  // The NAS can't see the panel: after a change it only knows whether the display came online.
  const ch = pl && pl.changes && pl.changes[0];
  const miss = pl && pl.missed && !pl.missed.resolvedAt ? pl.missed : null;
  if (miss && c && c.byDisplay && !tpShowing) {
    const was = 'probably still ' + (miss.stillShows && miss.stillShows.dates ? miss.stillShows.dates.map(day).join(' + ') : 'the photo before');
    onFrame = esc(was) + ' <span class="err">' + esc('(it missed the change of ' + fmt(miss.since) + (miss.count > 1 ? ' and ' + (miss.count - 1) + ' more' : '') + '; ' + c.items.map(what).join(' + ') + ' is due, sent as soon as it is back)') + '</span>';
  } else if (ch && c && c.byDisplay && !ch.online && Date.now() < ch.until) {
    onFrame += ' <span class="muted">(not confirmed yet: the NAS is looking for the display)</span>';
  }
  const rows = [
    ['On the frame', onFrame],
    ['Layout', c ? esc(c.kind) : '–'],
    ...(pl ? [
      ['Playlist', playlistHtml(pl)],
      ['Next change', fmt(pl.nextChange)],
      ['After a change', changesHtml(pl)],
    ] : [
      ['Sent', c && c.pushedAt ? fmt(c.pushedAt) : '–'],
      ['Next update', fmt(s.nextRun)],
    ]),
    ['Battery', batteryHtml(s)],
    ['Display', sleepHtml(s) + lightSleepHtml(s.lightSleep) + deepSleepHtml(s.deepSleep)],
    ['Sleep checks', watchHtml(s.check)],
    ...(s.cleaning !== undefined && s.sleep ? [['Panel cleaning', cleaningHtml(s.cleaning)]] : []),
    ['Display check', checkText(s)],
    ['This round', s.cycle ? esc(s.cycle.shown + ' of ' + s.cycle.total + ' photos ' + (pl ? 'shown or planned' : 'shown') + ' (round ' + s.cycle.n + ')') : '–'],
    ['Album', s.library ? esc(s.library.titles.join(', ') + ' · ' + s.library.count + ' photos · read ' ) + fmt(s.library.fetchedAt) : '–'],
  ];
  $('#info').innerHTML = rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('');
  const dup = s.lastError && ((s.sleep && s.sleep.error === s.lastError.message) || (hl && hl.text === s.lastError.message)); // already shown under Display, or at the top
  $('#error').textContent = s.lastError && !dup ? 'Last problem (' + fmt(s.lastError.at) + '): ' + s.lastError.message : '';
  $('#history').innerHTML = (s.history || []).slice(0, 8).map((h) => '<dt>' + fmt(h.at) + '</dt><dd>' + (h.ok ? (h.missed ? '<span class="err">' + esc(h.kind) + '</span>' : esc(h.kind)) + (h.dates && h.dates.length ? ' · ' + h.dates.map(day).join(' + ') : '') + (h.battery != null ? ' · battery ' + h.battery + '%' : '') + (h.waited ? ' · waited ' + h.waited + ' s for the display' : '') : '<span class="err">' + esc(h.error) + '</span>') + '</dd>').join('');
  renderView(s);
}
async function refresh() {
  try { const r = await fetch(u('/api/status')); if (r.status === 404) throw 0; render(await r.json()); } catch (e) { $('#state').textContent = 'offline'; }
  setTimeout(refresh, last && (last.busy || (last.generate && last.generate.busy)) ? 2500 : 15000);
}
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  showTab(b.dataset.view); history.replaceState(null, '', view === 'preview' ? location.pathname + location.search : '#' + view); if (last) renderView(last);
});
const asked = location.hash.slice(1).replace(/[^a-z]/g, '');
if (asked && document.querySelector('.tabs button[data-view="' + asked + '"]')) showTab(asked);
document.querySelectorAll('.actions button').forEach((b) => b.onclick = async () => {
  b.disabled = true;
  const r = await fetch(u('/api/' + b.dataset.act), { method:'POST' });
  if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || 'Failed'); }
  if (b.dataset.act === 'test-pattern') showTab('test');
  setTimeout(async () => { const r2 = await fetch(u('/api/status')); render(await r2.json()); }, 600);
});
// The Generate tab: one request per button, then a fresh look at the status.
async function post(path, body) {
  const r = await fetch(u(path), { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || 'Failed'); }
  const r2 = await fetch(u('/api/status')); if (r2.ok) render(await r2.json());
  return r.ok;
}
$('#genform').onsubmit = async (e) => {
  e.preventDefault();
  const prompt = $('#prompt').value.trim();
  if (!prompt) { $('#prompt').focus(); return; }
  $('#genbtn').disabled = true;
  await post('/api/generate', { prompt, style: $('#style').value });
};
$('#gallery').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-art]');
  if (!b) return;
  const id = b.closest('article').dataset.id;
  const item = ((last && last.generate && last.generate.items) || []).find((x) => x.id === id);
  if (b.dataset.art === 'reuse') { if (item) { $('#prompt').value = item.prompt; $('#prompt').focus(); } return; }
  if (b.dataset.art === 'delete' && !confirm('Delete this picture?' + (item && item.keep ? ' It is in the rotation.' : ''))) return;
  b.disabled = true;
  if (!await post('/api/art/' + b.dataset.art, { id })) b.disabled = false;
});
$('#gallery').addEventListener('change', (e) => {
  if (e.target.dataset.art === 'keep') post('/api/art/keep', { id: e.target.closest('article').dataset.id, keep: e.target.checked });
});
refresh();
</script>
</body>
</html>`;
