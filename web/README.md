# Bilderrahmen: web interface

The new interface for the emdx-photo-frame service ("Sechs Tinten"). Right now it is a clickable prototype: every screen works, all data comes from an in-memory mock. It is built in the real stack so it can become the real frontend by replacing the mock.

React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, dnd-kit, Motion, TanStack Query, React Router, Biome.

## Run it

```sh
cd web
npm install
npm run dev        # http://127.0.0.1:5183, this machine only
```

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Dev server on 127.0.0.1:5183              |
| `npm run build`   | Type-check, then build into `dist/`       |
| `npm run preview` | Serve the built `dist/` on 127.0.0.1:5184 |
| `npm run check`   | Biome lint and format check               |
| `npm run format`  | Biome, fixing what it can                 |

The page makes no network requests. Fonts (Nunito Sans, Barlow Condensed) are bundled from npm, pictures are drawn in code.

The prototype always runs on **Thursday 19 Nov 2026, 09:30** and moves on in real time from there (`src/lib/clock.ts`), so the mock house tells the same story on every start. Reloading the page resets all data.

Add `?darstellung=dunkel` or `?darstellung=hell` to any address to force dark or light mode; the choice is otherwise under Einstellungen → Darstellung.

## Where the mock ends and the backend begins

Everything the interface knows comes through one typed object:

| File                | Role                                                                       |
| ------------------- | -------------------------------------------------------------------------- |
| `src/api/types.ts`  | The data shapes (frames, pending changes, pictures, decks, Events …)       |
| `src/api/client.ts` | `PhotoFrameApi`: every call the interface makes                            |
| `src/api/index.ts`  | **The seam.** Exports `api`. Today `api = mockApi`                         |
| `src/api/mock/`     | In-memory implementation: `seed.ts` is the house, `index.ts` the behaviour |
| `src/api/hooks.ts`  | TanStack Query hooks around `api`; screens use only these                  |

To connect the real backend, write an object with the same methods (say `src/api/http.ts`) and export it from `src/api/index.ts`. It can move over one endpoint at a time:

```ts
export const api: PhotoFrameApi = { ...mockApi, getOverview: http.getOverview }
```

Then:

- set `prototype` in `src/api/index.ts` to `null`: that removes the "Knopf drücken" stand-in on the frame page;
- replace `now()` in `src/lib/clock.ts` with `Date.now()`;
- replace `artUrl()` (`src/lib/art.ts`, used in `src/components/picture.tsx` and the crop editor) with real image URLs. `Art` in `types.ts` then becomes a URL.

Sentences that tell the owner what will happen and when are built in `src/lib/explain.ts` from data the API returns (`Frame.nextOnline`, `ShowPlan`, `EventEstimate`). The backend should return those shapes rather than ready-made text.

Dialogs and sheets are opened from state, without a Radix trigger; `src/lib/return-focus.ts` hands the focus back to the control that opened them.

What the mock simulates: a change on a battery frame goes from "eingestellt" to "wartet auf Rahmen" and stays there until someone presses "Knopf drücken"; on a frame on mains power or on the charger it goes out at once and is confirmed a few seconds later. A battery frame added through the wizard is still awake from the button press of the connection test (`ConnectionTest.awakeUntil`, about 90 seconds): it gets its rhythm, its cleaning time and its Erkennungsbild at once. Added later than that, they wait like any other change.

A new frame has no past. Until its first delivery `Frame.current.pictureId` is `null` ("noch kein Bild von hier"); once it confirmed a test card, `Frame.current.card` says which card is on the panel and until when. Its first change, the time on the card and the times on its page all come from its rhythm (`firstChangeAfter` in `src/lib/cadence.ts`). Nothing is made up for it: no observed changes, no device check; the wizard's connection test is kept apart as `FrameDetail.setupTest`.

The overview has two views of the same wall (`/?ansicht=naechstes`): "Jetzt" needs only `Frame`, "Als Nächstes" reads `Frame.upNext` (the picture after the current one) and the pending changes. What a frame's signs say is derived in `src/components/frame-badges.tsx`.

There is no setting for how long a picture stays away. A picture comes back when its deck is through and reshuffled; `PictureWhere.shownThisRound` and `PictureWhere.justShown` tell the interface where it stands, and the backend alone decides how long "just shown" lasts. `ShowPlan.warnings` knows three reasons: `haengt`, `vorgemerkt`, `eben`.

The art catalogue is behind `HouseSettings.extras.art`. While it is on, the navigation shows "Kunst" (`/kunst`, on the phone under "Mehr"), `searchArt` and `importArt` are used, and each group offers `Group.art` ("Kunst untermischen"). The mock's catalogue is `src/api/mock/catalogue.ts`; it never asks paperlesspaper.

Every history entry about a pending change carries `HistoryEntry.change` (the change's id and the stage it reached), so setting, transfer and confirmation can be followed as one (`/verlauf?aenderung=<id>`). Pictures discarded from the Eingang are kept for 30 days (`listDiscarded`, `restoreInbox`).

## Design tokens

All of "Sechs Tinten" is in **`src/styles/tokens.css`**: colours for light and dark, fonts, type sizes, the spacing step, radii, the touch target. Change a value there and it changes everywhere. `src/index.css` only maps those tokens to Tailwind and shadcn names.

One colour, one meaning: blue = an action or something waiting for the frame, green = confirmed, yellow = soon, red = now.

## Layout of the code

```
src/
  api/          types, the API seam, the mock
  components/   shared pieces: frame object, pending queue, "Zeigen" sheet, sortable list …
  components/ui shadcn/ui components (generated, adjusted for 44 px touch targets)
  screens/      one file per screen
  lib/          clock, German formatting, sentences, placeholder art
  styles/       tokens.css
GLOSSARY.md     the fixed German vocabulary of the interface
```

The router is React Router in data mode (`src/App.tsx`). Addresses are German (`/rahmen/f4`, `/bibliothek?ansicht=eingang`); filters live in the query string so a view can be bookmarked.

Libraries that do the heavy lifting: `react-aria-components` (`TimeField`: times are always entered in 24 hours, whatever the browser's language; see `src/components/time-field.tsx`), `react-easy-crop` (crop window), `react-day-picker` via shadcn Calendar (Event days: in a popover on wide screens, in a bottom sheet on the phone, always in German; no native date input anywhere), `vaul` via shadcn Drawer (bottom sheets on the phone), Radix Dialog (dialogs on wide screens), `sonner` (toasts), `@dnd-kit` (reordering by drag, touch hold, arrow buttons or keyboard).
