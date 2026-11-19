import type { Art } from "@/api/types"

// Placeholder pictures, drawn only in the six inks of the panel so the prototype
// looks like what a frame can show. The real backend serves image files instead;
// then only `artUrl` has to go.

const K = "#1c1c1c"
const W = "#f2f2ee"
const [B, G, Y, R] = ["#24509a", "#2f7a4c", "#e3b400", "#b5302a"]
const INKS = [B, G, Y, R] // a b c d in the motifs below

type Motif = (a: string, b: string, c: string, d: string) => string

const person = (x: number, y: number, w: number, h: number, body: string, head: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${body}"/><circle cx="${x + w / 2}" cy="${y - 8}" r="${w / 2 - 0.5}" fill="${head}"/>`

const MOTIFS: Record<string, Motif> = {
  familie1: (a, b, c, d) =>
    `<rect width="120" height="120" fill="${a}"/><rect y="86" width="120" height="34" fill="${c}"/><circle cx="92" cy="22" r="9" fill="${W}"/>${person(38, 64, 14, 30, d, W)}${person(52, 58, 16, 36, K, W)}${person(69, 70, 12, 24, b, W)}`,
  familie2: (a, b, c, d) =>
    `<rect width="120" height="120" fill="${b}"/><rect width="120" height="48" fill="${W}"/><path d="M0 48 Q30 34 60 46 T120 42 V60 H0z" fill="${b}"/>${person(44, 64, 15, 34, c, K)}${person(62, 68, 14, 30, a, K)}<path d="M76 66 L84 40" stroke="${K}" stroke-width="1"/><ellipse cx="85" cy="32" rx="7" ry="9" fill="${d}"/>`,
  familie3: (a, _b, c, d) =>
    `<rect width="120" height="120" fill="${W}"/><rect y="88" width="120" height="32" fill="${K}"/><path d="M60 0 V26" stroke="${K}" stroke-width="1.5"/><path d="M50 36 L60 24 L70 36z" fill="${c}"/><rect x="36" y="76" width="48" height="5" fill="${K}"/>${person(40, 58, 13, 20, d, K)}${person(67, 58, 13, 20, a, K)}`,
  familie4: (a, _b, c, d) =>
    `<rect width="120" height="120" fill="${d}"/><circle cx="50" cy="56" r="13" fill="${W}"/><circle cx="72" cy="60" r="11" fill="${c}"/><path d="M30 120 Q32 78 50 76 Q62 78 64 120z" fill="${K}"/><path d="M58 120 Q60 80 73 78 Q88 80 90 120z" fill="${a}"/>`,
  familie5: (a, b, c, d) =>
    `<rect width="120" height="120" fill="${c}"/><rect y="70" width="120" height="50" fill="${a}"/>${person(42, 60, 13, 28, W, K)}${person(57, 66, 10, 22, d, K)}${person(69, 58, 14, 30, b, K)}`,
  kuchen: (a, _b, c, d) =>
    `<rect width="120" height="120" fill="${d}"/><rect y="90" width="120" height="30" fill="${K}"/><rect x="40" y="62" width="40" height="28" rx="3" fill="${W}"/><path d="M40 72 q5 6 10 0 t10 0 t10 0 t10 0" stroke="${a}" stroke-width="3" fill="none"/><path d="M50 62 V50 M60 62 V48 M70 62 V50" stroke="${c}" stroke-width="3"/><circle cx="50" cy="46" r="2.5" fill="${c}"/><circle cx="60" cy="44" r="2.5" fill="${c}"/><circle cx="70" cy="46" r="2.5" fill="${c}"/>`,
  katze1: (_a, _b, c, d) =>
    `<rect width="120" height="120" fill="${c}"/><rect y="94" width="120" height="26" fill="${W}"/><ellipse cx="60" cy="78" rx="15" ry="19" fill="${K}"/><circle cx="60" cy="52" r="12" fill="${K}"/><path d="M50 47 L52 34 L59 43z M70 47 L68 34 L61 43z" fill="${K}"/><path d="M73 92 q15 1 12 -17" stroke="${K}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="55.5" cy="51" r="2" fill="${c}"/><circle cx="64.5" cy="51" r="2" fill="${c}"/><circle cx="40" cy="92" r="5" fill="${d}"/>`,
  katze2: (a, _b, _c, d) =>
    `<rect width="120" height="120" fill="${a}"/><rect y="74" width="120" height="46" fill="${d}"/><ellipse cx="60" cy="70" rx="24" ry="11" fill="${W}"/><circle cx="40" cy="62" r="10" fill="${W}"/><path d="M32 58 L33 47 L40 54z M48 58 L47 47 L41 54z" fill="${W}"/><circle cx="66" cy="68" r="5" fill="${K}"/><path d="M83 72 q10 -2 8 -14" stroke="${W}" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M35 62 h3 M42 62 h3" stroke="${K}" stroke-width="1.6" stroke-linecap="round"/>`,
  katze3: (a, b, c) =>
    `<rect width="120" height="120" fill="${W}"/><rect x="26" y="26" width="68" height="44" fill="${a}"/><path d="M26 26h68v44H26z M60 26v44 M26 48h68" stroke="${K}" stroke-width="2" fill="none"/><rect y="70" width="120" height="6" fill="${K}"/><rect y="76" width="120" height="44" fill="${b}"/><ellipse cx="60" cy="62" rx="10" ry="9" fill="${c}"/><circle cx="60" cy="49" r="7" fill="${c}"/><path d="M54 46 L55 38 L60 44z M66 46 L65 38 L61 44z" fill="${c}"/>`,
  berge: (a, b, c) =>
    `<rect width="120" height="120" fill="${W}"/><circle cx="76" cy="40" r="10" fill="${c}"/><path d="M0 78 L34 44 L56 66 L74 50 L120 82 V120 H0z" fill="${a}"/><path d="M0 90 Q40 70 70 86 T120 80 V120 H0z" fill="${b}"/>`,
  meer: (a, _b, c, d) =>
    `<rect width="120" height="120" fill="${c}"/><rect y="58" width="120" height="62" fill="${a}"/><path d="M60 30 V66 L82 66z" fill="${W}"/><path d="M57 36 V66 L42 66z" fill="${d}"/><path d="M40 68 H84 L78 76 H46z" fill="${K}"/><path d="M10 92 q6 -5 12 0 t12 0 M70 100 q6 -5 12 0 t12 0" stroke="${W}" stroke-width="2" fill="none"/>`,
  stadt: (a, _b, c, d) =>
    `<rect width="120" height="120" fill="${a}"/><circle cx="34" cy="30" r="8" fill="${W}"/><rect x="28" y="56" width="16" height="40" fill="${K}"/><rect x="46" y="44" width="14" height="52" fill="${d}"/><rect x="62" y="62" width="18" height="34" fill="${W}"/><rect x="82" y="50" width="12" height="46" fill="${K}"/><path d="M50 50h2v4h-2z M55 50h2v4h-2z M50 60h2v4h-2z M55 60h2v4h-2z M67 68h3v4h-3z M73 68h3v4h-3z" fill="${c}"/><rect y="96" width="120" height="24" fill="${c}"/>`,
  leuchtturm: (a, b, c, d) =>
    `<rect width="120" height="120" fill="${W}"/><rect y="84" width="120" height="36" fill="${a}"/><path d="M0 84 Q30 74 62 82 L62 92 H0z" fill="${b}"/><path d="M54 80 L57 40 H67 L70 80z" fill="${d}"/><path d="M55.5 62 H68.5 L68 54 H56z" fill="${W}"/><rect x="55" y="33" width="14" height="7" fill="${K}"/><path d="M57 33 L62 26 L67 33z" fill="${K}"/><path d="M69 36 L100 28 V44z" fill="${c}"/>`,
  baum: (a, b, c, d) =>
    `<rect width="120" height="120" fill="${a}"/><rect y="96" width="120" height="24" fill="${W}"/><path d="M60 26 L78 56 H70 L84 80 H36 L50 56 H42z" fill="${b}"/><rect x="56" y="80" width="8" height="16" fill="${K}"/><path d="M60 18 l2.5 5 5.5 .8 -4 3.9 1 5.5 -5-2.6 -5 2.6 1-5.5 -4-3.9 5.5-.8z" fill="${c}"/><circle cx="54" cy="62" r="3" fill="${d}"/><circle cx="68" cy="70" r="3" fill="${c}"/><circle cx="60" cy="48" r="2.5" fill="${W}"/><circle cx="48" cy="74" r="2.5" fill="${W}"/><circle cx="22" cy="30" r="1.5" fill="${W}"/><circle cx="96" cy="44" r="1.5" fill="${W}"/><circle cx="100" cy="18" r="1.5" fill="${W}"/>`,
  kerze: (_a, b, c, d) =>
    `<rect width="120" height="120" fill="${K}"/><rect y="92" width="120" height="28" fill="${d}"/><rect x="52" y="54" width="16" height="38" rx="2" fill="${W}"/><path d="M60 54 V48" stroke="${W}" stroke-width="1.5"/><path d="M60 30 q7 9 0 18 q-7 -9 0 -18z" fill="${c}"/><path d="M30 92 q10 -12 22 -4 M68 88 q12 -8 22 4" stroke="${b}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="38" cy="86" r="3" fill="${d}"/><circle cx="84" cy="86" r="3" fill="${d}"/>`,
  // Works of art for the catalogue. They keep their own colours: `variant` only picks one of two versions.
  welle: () =>
    `<rect width="120" height="120" fill="${W}"/><rect width="120" height="26" fill="${Y}"/><path d="M82 92 L96 72 L110 92z" fill="${B}"/><path d="M91.5 78.5 L96 72 L100.5 78.5 L98 77 L96 79 L94 77z" fill="${W}"/><path d="M0 62 Q14 22 50 24 Q80 27 86 56 Q72 42 58 48 Q40 56 48 82 Q84 92 120 88 V120 H0z" fill="${B}"/><path d="M50 24 q10 -3 14 3 q7 -2 9 4 q7 0 8 7 q5 2 5 8 q-5 -5 -10 -2 q-2 -6 -8 -4 q-3 -6 -9 -3 q-4 -5 -9 -2z" fill="${W}"/><path d="M10 100 q8 -6 16 0 t16 0 M62 106 q8 -6 16 0 t16 0" stroke="${W}" stroke-width="2.5" fill="none"/>`,
  sterne: () =>
    `<rect width="120" height="120" fill="${B}"/><circle cx="96" cy="24" r="11" fill="${Y}"/><circle cx="99" cy="22" r="8" fill="${B}"/><path d="M14 46 q18 -18 36 0 t36 0" stroke="${W}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M30 62 q14 -12 28 0 t28 0" stroke="${Y}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="52" cy="20" r="4.5" fill="${Y}"/><circle cx="72" cy="30" r="3" fill="${W}"/><circle cx="34" cy="28" r="3" fill="${Y}"/><circle cx="18" cy="16" r="2.5" fill="${W}"/><path d="M0 92 Q30 76 60 88 T120 84 V120 H0z" fill="${K}"/><path d="M14 104 Q16 60 22 38 Q28 62 30 104z" fill="${K}"/><path d="M70 88 l5 -12 l5 12z" fill="${K}"/><path d="M52 96h4v4h-4z M62 100h4v4h-4z M84 96h4v4h-4z M98 100h4v4h-4z" fill="${Y}"/>`,
  seerosen: () =>
    `<rect width="120" height="120" fill="${G}"/><path d="M0 20 Q40 8 70 22 T120 16 V44 Q80 56 50 42 T0 50z" fill="${B}"/><path d="M0 78 Q30 64 62 78 T120 72 V98 Q84 110 56 96 T0 104z" fill="${B}"/><ellipse cx="30" cy="34" rx="15" ry="5" fill="${G}"/><ellipse cx="82" cy="30" rx="12" ry="4" fill="${G}"/><ellipse cx="44" cy="88" rx="18" ry="6" fill="${G}"/><ellipse cx="92" cy="86" rx="13" ry="4.5" fill="${G}"/><circle cx="28" cy="32" r="3.5" fill="${W}"/><circle cx="84" cy="29" r="3" fill="${R}"/><circle cx="40" cy="86" r="4" fill="${W}"/><circle cx="50" cy="89" r="3" fill="${R}"/><circle cx="94" cy="85" r="3" fill="${W}"/><circle cx="64" cy="60" r="2.5" fill="${Y}"/>`,
  wanderer: () =>
    `<rect width="120" height="120" fill="${W}"/><path d="M0 62 L22 44 L40 58 L70 34 L96 56 L120 46 V86 H0z" fill="${B}"/><path d="M0 74 Q30 62 60 72 T120 68 V96 H0z" fill="${W}"/><path d="M0 90 Q40 78 80 90 T120 86 V120 H0z" fill="${B}"/><path d="M34 120 L48 92 L60 86 L74 94 L88 120z" fill="${K}"/><rect x="56" y="62" width="9" height="26" rx="2" fill="${K}"/><circle cx="60.5" cy="57" r="4.5" fill="${K}"/><path d="M56 60 q4 -7 9 0" stroke="${R}" stroke-width="2.5" fill="none"/><path d="M66 70 L72 90" stroke="${K}" stroke-width="1.6"/>`,
  fuji: () =>
    `<rect width="120" height="120" fill="${B}"/><path d="M0 22h46 M60 30h60 M10 40h34 M74 44h40 M0 54h24" stroke="${W}" stroke-width="3" stroke-linecap="round"/><path d="M0 104 L44 60 L60 38 L70 50 L120 96 V120 H0z" fill="${R}"/><path d="M52 49 L60 38 L68 48 L64 47 L61 51 L58 46 L55 50z" fill="${W}"/><path d="M0 104 Q40 92 78 106 T120 104 V120 H0z" fill="${G}"/>`,
  sonnenblumen: () =>
    `<rect width="120" height="120" fill="${B}"/><rect y="88" width="120" height="32" fill="${R}"/><path d="M46 70 H74 L70 100 H50z" fill="${W}"/><path d="M47 80 H73" stroke="${K}" stroke-width="1.5"/><path d="M60 70 V44 M54 70 L40 50 M66 70 L82 52" stroke="${G}" stroke-width="3"/><circle cx="60" cy="38" r="12" fill="${Y}"/><circle cx="60" cy="38" r="5" fill="${K}"/><circle cx="38" cy="48" r="10" fill="${Y}"/><circle cx="38" cy="48" r="4" fill="${K}"/><circle cx="84" cy="50" r="10" fill="${Y}"/><circle cx="84" cy="50" r="4" fill="${R}"/>`,
  weizenfeld: () =>
    `<rect width="120" height="120" fill="${B}"/><path d="M6 26 q14 -14 28 0 t28 0 t28 0" stroke="${W}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M40 44 q12 -10 24 0 t24 0" stroke="${W}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M0 70 L30 58 L64 66 L120 54 V80 H0z" fill="${G}"/><rect y="76" width="120" height="44" fill="${Y}"/><path d="M0 92 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 M0 106 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0" stroke="${R}" stroke-width="1.6" fill="none"/><path d="M88 84 Q86 44 94 18 Q102 46 100 84z" fill="${K}"/><path d="M76 84 Q76 58 81 44 Q86 60 86 84z" fill="${G}"/>`,
  raster: () =>
    `<rect width="120" height="120" fill="${W}"/><rect x="34" y="0" width="86" height="78" fill="${R}"/><rect x="0" y="82" width="30" height="38" fill="${B}"/><rect x="100" y="98" width="20" height="22" fill="${Y}"/><path d="M32 0 V120 M0 80 H120 M0 40 H32 M98 80 V120 M98 98 H120" stroke="${K}" stroke-width="4"/>`,
  perle: () =>
    `<rect width="120" height="120" fill="${K}"/><path d="M34 120 Q36 90 60 86 Q86 90 90 120z" fill="${Y}"/><ellipse cx="60" cy="58" rx="18" ry="22" fill="${W}"/><path d="M40 52 Q42 28 62 28 Q80 30 80 46 Q62 36 40 52z" fill="${B}"/><path d="M76 40 Q88 60 80 92 Q74 70 74 48z" fill="${Y}"/><circle cx="53" cy="56" r="2" fill="${K}"/><circle cx="66" cy="56" r="2" fill="${K}"/><path d="M56 70 q4 2 8 0" stroke="${R}" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="76" cy="76" r="3.5" fill="${W}"/>`,
  heuhaufen: () =>
    `<rect width="120" height="120" fill="${Y}"/><path d="M0 52 Q30 44 60 50 T120 46 V70 H0z" fill="${B}"/><rect y="66" width="120" height="54" fill="${G}"/><path d="M22 92 Q24 62 46 54 Q68 62 70 92z" fill="${R}"/><path d="M22 92 Q46 84 70 92 L68 76 Q46 70 24 76z" fill="${K}"/><path d="M76 86 Q77 68 90 62 Q103 68 104 86z" fill="${R}"/><path d="M70 96 H112 M18 100 H74" stroke="${B}" stroke-width="4" stroke-linecap="round"/>`,
  jatte: () =>
    `<rect width="120" height="120" fill="${G}"/><path d="M0 0 H120 V30 Q80 40 40 32 T0 36z" fill="${B}"/><path d="M70 22 l10 -12 v12z" fill="${W}"/><path d="M0 0 H34 Q40 22 22 34 Q10 28 0 36z" fill="${K}"/><path d="M84 110 Q84 76 92 72 Q100 76 100 110z" fill="${K}"/><circle cx="92" cy="66" r="4.5" fill="${K}"/><path d="M80 62 Q92 48 104 62z" fill="${R}"/><path d="M92 62 V72" stroke="${K}" stroke-width="1.4"/><path d="M62 110 Q62 82 68 80 Q74 82 74 110z" fill="${B}"/><circle cx="68" cy="75" r="3.5" fill="${W}"/><path d="M18 106 Q28 92 46 100 L44 108z" fill="${W}"/><circle cx="22" cy="98" r="4" fill="${Y}"/><path d="M40 84 q5 -4 9 0 l-1 6 h-7z" fill="${K}"/>`,
  bruecke: () =>
    `<rect width="120" height="120" fill="${G}"/><rect y="70" width="120" height="50" fill="${B}"/><path d="M0 0 H30 Q36 30 18 52 Q8 44 0 50z M120 0 H88 Q84 28 102 50 Q112 42 120 48z" fill="${K}"/><path d="M4 56 Q60 20 116 56" stroke="${W}" stroke-width="5" fill="none"/><path d="M4 66 Q60 30 116 66" stroke="${W}" stroke-width="3" fill="none"/><path d="M22 47 V57 M40 37 V47 M60 33 V43 M80 37 V47 M98 47 V57" stroke="${W}" stroke-width="2.4"/><ellipse cx="32" cy="88" rx="14" ry="4" fill="${G}"/><ellipse cx="82" cy="98" rx="17" ry="5" fill="${G}"/><ellipse cx="64" cy="80" rx="9" ry="3" fill="${G}"/><circle cx="30" cy="87" r="3" fill="${W}"/><circle cx="86" cy="97" r="3.5" fill="${R}"/><circle cx="64" cy="79" r="2.5" fill="${Y}"/>`,
  testbild: () =>
    `<rect width="120" height="120" fill="${W}"/><rect x="30" y="34" width="10" height="56" fill="${K}"/><rect x="40" y="34" width="10" height="56" fill="#b5302a"/><rect x="50" y="34" width="10" height="56" fill="#e3b400"/><rect x="60" y="34" width="10" height="56" fill="#2f7a4c"/><rect x="70" y="34" width="10" height="56" fill="#24509a"/><rect x="80" y="34" width="10" height="56" fill="${W}" stroke="${K}" stroke-width=".8"/><path d="M60 14 l6 9 h-12z" fill="${K}"/><text x="60" y="31" font-size="6" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="${K}">OBEN</text>`,
}

// Works of art come in versions of themselves (a series, an evening view): `variant` swaps two inks.
const ART_MOTIFS = new Set([
  "welle",
  "sterne",
  "seerosen",
  "wanderer",
  "fuji",
  "sonnenblumen",
  "weizenfeld",
  "raster",
  "perle",
  "heuhaufen",
  "jatte",
  "bruecke",
])
const SWAPS: ([string, string] | null)[] = [null, [B, R], [B, G], [Y, G], [R, K]]
const swapInks = (svg: string, pair: [string, string] | null) =>
  pair ? svg.replaceAll(pair[0], "\u0000").replaceAll(pair[1], pair[0]).replaceAll("\u0000", pair[1]) : svg

// The 24 ways to hand the four colours to a motif; `variant` picks one.
const ORDERS: number[][] = []
for (let a = 0; a < 4; a++)
  for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) for (let d = 0; d < 4; d++) if (new Set([a, b, c, d]).size === 4) ORDERS.push([a, b, c, d])

const cache = new Map<string, string>()

/** A picture as an image URL, in its own shape (width × height). */
export function artUrl(art: Art, width = 1200, height = 1200): string {
  if (art.url) return width === 1200 && height === 1200 ? art.url : art.originalUrl || art.url
  const key = `${art.motif}/${art.variant}/${width}x${height}`
  let url = cache.get(key)
  if (!url) {
    const draw = MOTIFS[art.motif] ?? MOTIFS.berge
    const [a, b, c, d] = ORDERS[art.variant % ORDERS.length].map((i) => INKS[i])
    const body = ART_MOTIFS.has(art.motif) ? swapInks(draw(a, b, c, d), SWAPS[art.variant % SWAPS.length]) : draw(a, b, c, d)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice">${body}</svg>`
    url = `data:image/svg+xml,${encodeURIComponent(svg)}`
    cache.set(key, url)
  }
  return url
}

export const MOTIF_NAMES = Object.keys(MOTIFS).filter((m) => !ART_MOTIFS.has(m))
