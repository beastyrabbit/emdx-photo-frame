# Managed interface

The service serves the new interface at `/` and the upstream page at `/alt`.
It adopts env-configured frames and existing folder pictures on first start.
Health checks respond during adoption; frame actions stay blocked until it finishes.
Unreadable or rejected pictures are skipped and recorded in Verlauf.
The original state and playlist files stay in place. Manager state, copied
pictures, prepared programs and encrypted credentials live under
`DATA_DIR/manager`. Back up the complete volume before upgrading.

Each frame belongs to a group. The group's album labels choose its pictures.
Each group has a portrait and a landscape deck. Pictures and combinations
share ownership across groups. A frame that cannot be reached retains its
locks until it receives a replacement buffer or is explicitly removed.

Upload pictures into the Eingang, check their crop and accept them into the
library. Use album labels to include them in a group's theme. Discarded
inbox pictures can be restored for 30 days. Paused pictures stay in the
library. Deleted pictures may remain on a frame until it changes.

“Jetzt” replaces the current picture at the next safe contact. “Als Nächstes”
keeps the current picture and starts the selection at the following change.
Long selections continue through subsequent buffers. A sleeping frame is
looked for with TCP-only probes roughly every five seconds while changes
wait, for up to twelve hours. Press its button to bring it online.

Reads, settings and read-back precede the content command. No MDC command is
sent after it. A persisted guard lasts until EHOSTUNREACH or the next change.
This guard also delays another request on a mains or charging frame if it
has just received content. Outside that guard, those frames apply changes
immediately. Quiet windows around changes and cleaning still apply.

Events include their start, ordered pictures and normal fallback in the
downloaded playlist. A frame can switch offline. Its playlist is finite and
loops: after exhaustion, an Event may appear again if the service cannot
replace it. Button-wake before an Event starts is recommended when the next
expected contact is too late. The UI shows this limitation and a planning
range for extra battery use. Neither a downloaded picture nor a cadence is
reported as visually confirmed on the panel. Cleaning settings are checked
by MDC read-back; this write path still needs supervised hardware testing.

## Art and photos

With "Kunstkatalog" switched on in Einstellungen, the "Kunst" area finds
public-domain works and free photos and copies the chosen ones into the
Eingang. None of the sources needs a key.

- **Kunstwerke**: a search asks the Metropolitan Museum (paintings), the
  Cleveland Museum of Art, SMK in Copenhagen and Wikimedia Commons (files
  marked PD-Art) directly, and the results take turns. One collection can be
  chosen on its own. Without a search word, and with "Auswahl des Katalogs",
  the curated top picks of the paperlesspaper catalogue are shown; a single
  museum shows its paintings instead.
- **Fotos**: CC0 photos from the WordPress Photo Directory. Openverse orders
  the search results; when Openverse refuses (it allows 20 anonymous requests
  a minute and 200 a day), the directory's own search answers. Without a
  search word the newest photos are shown.

All of these search best in English ("flowers", not "Blumen"). "Mehr laden"
fetches the next page. A collection that does not answer is named above the
results, and the next "Mehr laden" asks it again. The Met refuses requests
for a minute or so after a burst; the other collections still answer.
Pictures shorter than 1440 pixels on their short side are marked, since the
frame would enlarge them. Works taken from the old Art Institute of Chicago
choice keep their credit.

The service needs outbound HTTPS to `collectionapi.metmuseum.org`,
`images.metmuseum.org`, `openaccess-api.clevelandart.org`,
`openaccess-cdn.clevelandart.org`, `api.smk.dk`, `iip.smk.dk`,
`iip-thumb.smk.dk`, `commons.wikimedia.org`, `upload.wikimedia.org`,
`api.openverse.org`, `wordpress.org`, `pd.w.org` and
`art.paperlesspaper.de`.

## Runtime configuration

Existing `EMDX_*`, `PHOTO_DIR`, schedule, panel, server and sleep settings seed
the registry once. Later edits come from the interface. Keep `EMDX_PIN` for
the adopted frame. Added frames inherit it unless a PIN is entered. Add each
new IP to the network's MDC allow policy and follow the wizard's Samsung
deep-sleep checklist.

Optional integration settings:

| Variable | Meaning |
| --- | --- |
| `IMMICH_URL` | Immich 3.4.x API base; locks the address in the interface |
| `IMMICH_API_KEY` | Read-only integration key; locks the key slot |
| `OPENROUTER_API_KEY` | Future generation key slot; no generation feature |
| `SECRETS_KEY` | 32-byte master key in hex or base64 |
| `UI_PASSWORD` | Optional existing HTTP Basic authentication |
| `UI_HOSTS` | Comma-separated UI hostnames, such as `frame.heerlab.com`, including the hostname used by the SSO proxy |

UI, API and media requests accept IP literals, `localhost`, `SERVER_HOST`
and the names in `UI_HOSTS`. Other Host headers are refused before routing,
including on `/alt`. Display downloads, transfer callbacks and `/healthz`
do not use this restriction. Forwarded host headers do not grant access.

Without `SECRETS_KEY`, the service creates a mode-0600 key file in
`DATA_DIR/manager/key`. Preserve this file with encrypted credentials.
Integration keys and stored device PINs are never returned by the API.
Immich needs `album.read`, `asset.read`, `asset.view`, `asset.download` and,
for the people picker, `person.read`. Imported files are independent copies,
preferring Immich's edited version. Album subscriptions poll every 15 minutes.
Each subscription imports at most ten new pictures and reads at most ten pages
per poll, resuming on the next poll. Working copies are metadata-free JPEGs
at quality 92, capped at twice the panel's long side. Originals stay untouched.
Imports pause below 256 MiB free on `/data`, with a message in the interface
or Verlauf. A 16 MiB disk reserve protects state saves for prepared deliveries;
free space promptly if imports pause. Imports and renders share one work queue.

The container runs with a read-only root filesystem, writable `/data` and
`/tmp`, uid 1000 and a 1 GiB memory limit. No new volume or required env var
is needed. Uploads allow ten raster images, 25 MiB each and 100 MiB per
request, with bounded pixel and decoder limits. HEVC decoding uses libheif.
There is no web password by default; external access belongs behind SSO.
The API requires same-origin mutations with a bootstrap CSRF token.
