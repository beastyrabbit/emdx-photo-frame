import { cn } from "cn"
import { CalendarRange, Check, Hand, Images, Moon, RefreshCw, ScanLine, Settings2, Stethoscope, X } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router"
import { api, type FrameAction, prototype } from "@/api"
import { useAct, useFrame, useHistory, useOverview, usePending, useTimeline } from "@/api/hooks"
import { usePictureMap } from "@/api/lookups"
import type { FrameDetail } from "@/api/types"
import { Banner, Facts, Fold, Hint, PageHead, Section } from "@/components/bits"
import { FramePicker } from "@/components/frame-picker"
import { HistoryLine } from "@/components/history-line"
import { Meter, PowerFigure, powerLine, SettingMark, StateMark } from "@/components/marks"
import { PendingQueue } from "@/components/pending-queue"
import { Thumb } from "@/components/picture"
import { Segmented } from "@/components/segmented"
import { FramePanel, TestCard } from "@/components/test-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cadenceText, everyText, rhythmNow } from "@/lib/cadence"
import { DAY, now } from "@/lib/clock"
import { cardUntil, whenOnline } from "@/lib/explain"
import { fmtAgo, fmtDay, fmtWhen, plural } from "@/lib/format"
import { FrameTimeline } from "./schedule"

/** One thing you can do to the frame, with what it does written next to it. */
function ActionRow({
  icon: Icon,
  title,
  text,
  button,
  onClick,
  disabled,
  to,
  preview,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  text: string
  button: string
  onClick?: () => void
  disabled?: boolean
  to?: string
  /** What the frame will show, for actions that put test content on it. */
  preview?: React.ReactNode
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-t border-line py-3 min-[560px]:grid-cols-[auto_minmax(0,1fr)_auto]">
      <Icon className="mt-0.5 size-5 text-ink-soft" />
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-[15px] text-ink-soft">{text}</div>
        {preview && <div className="mt-2">{preview}</div>}
      </div>
      {to ? (
        <Button asChild variant="outline" size="sm" className="col-start-2 w-fit min-[560px]:col-start-3">
          <Link to={to}>{button}</Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="col-start-2 w-fit min-[560px]:col-start-3" onClick={onClick} disabled={disabled}>
          {button}
        </Button>
      )}
    </li>
  )
}

/** "heute 16:00" when it is that close, otherwise the day. */
const untilText = (t: number) => (t - now() < 2 * DAY ? fmtWhen(t) : fmtDay(t))

function sleepLine(f: FrameDetail): string {
  if (!f.sleep.asleep) return f.power === "dauerstrom" ? "wach, am Strom" : f.charging ? "wach, am Ladegerät" : "wach"
  const since = f.sleep.since ? ` seit ${fmtWhen(f.sleep.since)}` : ""
  if (f.sleep.onWifi && f.justUpdated) return `schläft${since}, noch kurz im WLAN (gerade aktualisiert)`
  return `im Tiefschlaf${since}, nicht im WLAN`
}

export function FrameDetailScreen() {
  const { id = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get("ansicht") === "zeitplan" ? "zeitplan" : "ueberblick"
  const { data: f } = useFrame(id)
  const { data: overview } = useOverview()
  if (!f) {
    return (
      <div className="grid gap-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="aspect-9/16 w-40 rounded-picture" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const group = overview?.groups.find((g) => g.id === f.groupId)

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <PageHead title={f.name} back={{ to: "/", label: "Übersicht" }}>
          <Button asChild variant="outline" size="sm">
            <Link to={`/einstellungen/rahmen/${f.id}`}>
              <Settings2 />
              Einstellungen
            </Link>
          </Button>
        </PageHead>
        <p className="-mt-2 text-small text-ink-soft">
          {f.device}, {f.ip}. {group ? <Link to={`/gruppen/${group.id}`}>{group.name}</Link> : null}, {f.orientation === "hoch" ? "Hochformat" : "Querformat"}
          {f.upsideDown ? ", auf dem Kopf montiert" : ""}
          {f.tags.length ? `, ${f.tags.join(", ")}` : ""}
        </p>
        {overview && (
          <FramePicker
            compact
            label="Rahmen wechseln"
            frames={overview.frames}
            groups={overview.groups}
            frameId={f.id}
            frameTo={(other) => `/rahmen/${other.id}${tab === "zeitplan" ? "?ansicht=zeitplan" : ""}`}
          />
        )}
        <Segmented
          label="Ansicht"
          value={tab}
          onChange={(v) => setParams(v === "zeitplan" ? { ansicht: "zeitplan" } : {}, { replace: true })}
          className="min-[560px]:w-fit min-[560px]:min-w-[340px]"
          options={[
            { value: "ueberblick", label: "Überblick" },
            { value: "zeitplan", label: "Zeitplan" },
          ]}
        />
      </div>

      {tab === "zeitplan" ? <FrameTimeline frame={f} key={f.id} /> : <FrameOverview f={f} />}
    </div>
  )
}

/** Everything about the frame except its schedule: state, waiting changes, actions, the details. */
function FrameOverview({ f }: { f: FrameDetail }) {
  const id = f.id
  const { data: overview } = useOverview()
  const pending = usePending(id)
  const history = useHistory(id)
  const pictures = usePictureMap()
  const act = useAct(
    (action: FrameAction) => api.frameAction(id, action),
    (_r, action) =>
      ({
        erkennungsbild: "Erkennungsbild eingestellt",
        testbild: "Testbild eingestellt",
        "neu-senden": "Eingestellt: Bilder werden neu geladen",
        pruefen: "Prüfung angestoßen",
        tiefschlaf: "Tiefschlaf angestoßen",
      })[action],
  )
  const press = useAct((frameId: string) => prototype?.pressButton(frameId) ?? Promise.resolve(), "Knopf gedrückt: der Rahmen meldet sich")
  const group = overview?.groups.find((g) => g.id === f.groupId)
  const event = overview?.events.find((e) => e.id === f.eventId)
  const picture = f.current.pictureId ? pictures.get(f.current.pictureId) : undefined
  const online = whenOnline(f)
  const reach = f.nextOnline.immediate
  const cleaningPending = !f.cleaning.confirmedAt
  // What the panel shows: a picture, a test card the frame confirmed, or nothing of ours yet (a frame just added).
  const card = f.current.card
  const cardName = card?.kind === "testbild" ? "Testbild" : "Erkennungsbild"
  const nothingYet = !f.current.pictureId && !card
  const idCard = (pending.data ?? []).find((p) => p.kind === "erkennungsbild" && p.state !== "bestaetigt")
  // A test card arrives when the frame is next reachable and stays until its change after that.
  const previewUntil = cardUntil(f, f.nextOnline.at, event?.everyMin)
  const neverChanged = f.changeStats.watched === 0

  return (
    <>
      {f.health.level === "bad" && (
        <Banner level="bad" title={`Knopf am Rahmen drücken${f.battery && f.battery.percent < 10 ? ", dann laden" : ""}`}>
          <p>{f.health.text} Sobald er wach ist, bekommt er von selbst neue Bilder und alles, was unten wartet.</p>
        </Banner>
      )}
      {f.health.level === "warn" && (
        <Banner level="warn" title={f.health.title}>
          <p>{f.health.text} Unter „Änderungen für diesen Rahmen“ entscheidest du, welcher Wert gilt.</p>
        </Banner>
      )}
      {f.charging && (
        <Banner level="plain" title="Lädt gerade">
          <p>Am Ladegerät bleibt der Rahmen erreichbar. Änderungen gehen sofort raus, „Jetzt zeigen“ dauert nur Sekunden.</p>
        </Banner>
      )}
      {event && (
        <Banner level="plain" icon={CalendarRange} title={`Event „${event.name}“ läuft bis ${fmtWhen(event.end)}`}>
          <p>
            {everyText(event.everyMin).replace(/^./, (c) => c.toUpperCase())} ein neues Bild. Danach wieder {cadenceText(f.cadence.value)}.{" "}
            <Link to={`/events/${event.id}`}>Event ansehen</Link>
          </p>
        </Banner>
      )}

      <section className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-5">
        <div className="grid justify-items-center gap-1.5">
          <FramePanel
            frame={f}
            groupName={group?.name ?? ""}
            className={f.orientation === "hoch" ? "w-[132px] min-[560px]:w-[190px]" : "w-[160px] min-[560px]:w-[300px]"}
          />
        </div>
        <div className="grid content-start gap-4">
          {nothingYet ? (
            <div>
              <StateMark level={f.health.level === "ok" ? "wait" : f.health.level}>
                {idCard ? "Erkennungsbild noch nicht bestätigt" : "Noch kein Bild von hier"}
              </StateMark>
              <p className="mt-1 text-[15px]">
                {!idCard
                  ? "Die ersten Bilder bekommt der Rahmen, sobald er sich meldet."
                  : idCard.state === "uebertragen" || reach
                    ? "Es geht gerade raus und ist in wenigen Sekunden zu sehen."
                    : "Drück den Knopf am Rahmen, damit es jetzt ankommt."}{" "}
                Bis dahin ist offen, was der Rahmen zeigt.
              </p>
            </div>
          ) : card ? (
            <div>
              <StateMark level={f.health.level}>{f.justUpdated && f.health.level === "ok" ? "Gerade aktualisiert" : f.health.title}</StateMark>
              <p className="mt-1 text-[15px]">
                Zeigt sein <strong className="font-semibold">{cardName}</strong>, seit {fmtWhen(f.current.since)}.
              </p>
              <p className="mt-1 text-[15px]">
                {cardName} bis {fmtWhen(card.until)}. Danach {neverChanged ? "beginnt dein normaler Zeitplan" : "geht dein normaler Zeitplan weiter"}.
              </p>
            </div>
          ) : (
            <div>
              <StateMark level={f.health.level}>{f.justUpdated && f.health.level === "ok" ? "Gerade aktualisiert" : f.health.title}</StateMark>
              <p className="mt-1 text-[15px]">
                {f.current.unsure ? "Zeigt wahrscheinlich noch " : "Zeigt "}
                {picture ? (
                  <Link to={`/bild/${picture.id}`} className="font-semibold">
                    {picture.title}
                  </Link>
                ) : (
                  "ein Bild"
                )}
                {f.current.unsure ? "." : `, seit ${fmtWhen(f.current.since)}.`}
                {f.current.unsure && (
                  <Hint label="Warum wahrscheinlich?">
                    Der Server sieht den Bildschirm nicht. Er weiß nur, ob sich der Rahmen nach einem Wechsel gemeldet hat. Das Bild ist gestreift, solange das
                    offen ist.
                  </Hint>
                )}
              </p>
            </div>
          )}
          <div className="grid gap-1">
            <PowerFigure frame={f} size="lg" />
            <p className={cn("text-[15px]", f.battery && !f.charging && f.battery.percent < 10 && "font-semibold text-red")}>
              {powerLine(f).replace(/^./, (c) => c.toUpperCase())}
            </p>
          </div>
          <Facts
            className="max-[559px]:hidden"
            rows={[
              ["Nächster Wechsel", `${fmtWhen(f.nextChange)}, ${event ? `${everyText(event.everyMin)} (Event)` : rhythmNow(f.cadence)}`],
              [
                "Gemeldet",
                f.lastOnline.secondsAfterChange !== null
                  ? `${fmtWhen(f.lastOnline.at)}, ${f.lastOnline.secondsAfterChange} s nach dem Wechsel`
                  : `zuletzt ${fmtWhen(f.lastOnline.at)}`,
              ],
            ]}
          />
        </div>
      </section>

      <Facts
        className="-mt-3 min-[560px]:hidden"
        rows={[
          ["Nächster Wechsel", `${fmtWhen(f.nextChange)}, ${event ? `${everyText(event.everyMin)} (Event)` : rhythmNow(f.cadence)}`],
          [
            "Gemeldet",
            f.lastOnline.secondsAfterChange !== null
              ? `${fmtWhen(f.lastOnline.at)}, ${f.lastOnline.secondsAfterChange} s nach dem Wechsel`
              : `zuletzt ${fmtWhen(f.lastOnline.at)}`,
          ],
        ]}
      />

      <Section
        title="Änderungen für diesen Rahmen"
        className="scroll-mt-6"
        aside={
          <Hint>
            {reach
              ? "Dieser Rahmen ist immer erreichbar. Änderungen gehen sofort raus; hier siehst du, ob er sie bestätigt hat."
              : "Alles, was du für diesen Rahmen änderst, kommt zusammen an, sobald er sich meldet. Erst Einstellungen, zuletzt die Bilder. Bis dahin kannst du jede Änderung zurücknehmen."}
          </Hint>
        }
      >
        <div id="aenderungen">
          <PendingQueue frame={f} changes={pending.data ?? []} />
        </div>
        {prototype && !reach && (
          <div className="flex flex-wrap items-center gap-3 rounded-control border border-dashed border-line px-4 py-3 text-[15px] text-ink-soft">
            <span className="min-w-0 flex-1">Nur im Prototyp: so tun, als hätte jemand den Knopf am Rahmen gedrückt.</span>
            <Button variant="outline" size="sm" disabled={press.isPending} onClick={() => press.mutate(f.id)}>
              <Hand />
              Knopf drücken
            </Button>
          </div>
        )}
      </Section>

      <Section title="Jetzt tun">
        <ul className="m-0 list-none p-0 [&>li:last-child]:border-b">
          <ActionRow
            icon={Images}
            title="Bild zeigen"
            text={
              reach
                ? "Such ein Bild aus und wähle „Jetzt“ oder „Als Nächstes“. Geht sofort raus."
                : `Such ein Bild aus und wähle „Jetzt“ oder „Als Nächstes“. Wird übertragen: ${online}.`
            }
            button="Bild aussuchen"
            to={`/bibliothek?format=${f.orientation}&rahmen=${f.id}`}
          />
          <ActionRow
            icon={CalendarRange}
            title="Reihenfolge ändern"
            text="Die nächsten Bilder dieses Rahmens ansehen und umsortieren."
            button="Zeitplan öffnen"
            to={`/rahmen/${f.id}?ansicht=zeitplan`}
          />
          <ActionRow
            icon={ScanLine}
            title="Erkennungsbild zeigen"
            text={`${f.name} zeigt diese Karte, damit du siehst, welcher Rahmen es ist und wie herum er hängt: ${online}.${reach ? "" : " Kostet einen zusätzlichen Bildaufbau."} Beim nächsten Wechsel kommt wieder ein Bild.`}
            preview={
              <TestCard
                kind="erkennungsbild"
                frame={f}
                groupName={group?.name ?? ""}
                from={f.nextOnline.at}
                until={previewUntil}
                className={f.orientation === "hoch" ? "w-[120px]" : "w-[210px]"}
              />
            }
            button="Erkennungsbild zeigen"
            onClick={() => act.mutate("erkennungsbild")}
            disabled={act.isPending}
          />
          <ActionRow
            icon={ScanLine}
            title="Testbild zeigen"
            text={`Zum Prüfen von Ausrichtung, Farben und Schärfe. Auf der Karte steht, für welchen Rahmen und welche Zeit sie gilt und worauf du achten sollst: ${online}.${reach ? "" : " Kostet einen zusätzlichen Bildaufbau."}`}
            preview={
              <TestCard
                kind="testbild"
                frame={f}
                groupName={group?.name ?? ""}
                from={f.nextOnline.at}
                until={previewUntil}
                className={f.orientation === "hoch" ? "w-[120px]" : "w-[210px]"}
              />
            }
            button="Testbild zeigen"
            onClick={() => act.mutate("testbild")}
            disabled={act.isPending}
          />
          <ActionRow
            icon={RefreshCw}
            title="Bilder neu laden"
            text={`Lädt den Vorrat von ${f.buffer} Bildern frisch auf den Rahmen: ${online}. Was gerade hängt, bleibt.`}
            button="Neu laden"
            onClick={() => act.mutate("neu-senden")}
            disabled={act.isPending}
          />
          <ActionRow
            icon={Stethoscope}
            title="Rahmen prüfen"
            text={
              reach
                ? "Liest jetzt Akku und Einstellungen vom Rahmen."
                : "Liest Akku und Einstellungen, wenn sich der Rahmen das nächste Mal meldet. Weckt ihn nicht."
            }
            button="Prüfen"
            onClick={() => act.mutate("pruefen")}
            disabled={act.isPending}
          />
          {(reach || f.sleep.onWifi) && f.power === "akku" && (
            <ActionRow
              icon={Moon}
              title="Tiefschlaf jetzt"
              text="Schickt den Rahmen sofort schlafen, wie der Knopf „Sleep“ in der Samsung-App. Danach ist er erst nach seinem nächsten Wechsel wieder erreichbar."
              button="Schlafen schicken"
              onClick={() => act.mutate("tiefschlaf")}
              disabled={act.isPending}
            />
          )}
        </ul>
      </Section>

      <Section title="Alles über diesen Rahmen">
        <div>
          <Fold
            title="Bilder am Rahmen"
            summary={
              !f.delivery
                ? "Noch kein Vorrat geladen: kommt mit der ersten Meldung"
                : f.delivery.usedUp
                  ? f.health.level === "bad"
                    ? "Vorrat aufgebraucht: er wiederholt seine letzten Bilder"
                    : "Noch kein Vorrat geladen"
                  : `${plural(f.bufferLeft, "Bild liegt", "Bilder liegen")} bereit, ${f.buffer} auf Vorrat eingestellt`
            }
            tone={f.delivery?.usedUp ? "warn" : undefined}
          >
            <p className="text-[15px] text-ink-soft">
              Der Rahmen wechselt von selbst durch diese Bilder, auch wenn der Server nicht erreichbar ist. Jedes Mal, wenn er sich meldet, bekommt er frischen
              Vorrat.
            </p>
            <div className="flex flex-wrap gap-3">
              <BufferStrip frameId={f.id} />
            </div>
            {f.delivery && (
              <Facts
                rows={[
                  ["Zuletzt geladen", `${fmtWhen(f.delivery.sentAt)}, ${plural(f.delivery.pictures, "Bild", "Bilder")}`],
                  [
                    "Reicht bis",
                    f.delivery.usedUp ? (
                      <span key="leer" className="text-yellow-ink">
                        aufgebraucht seit {fmtWhen(f.delivery.endsAt)}
                      </span>
                    ) : (
                      fmtWhen(f.delivery.endsAt)
                    ),
                  ],
                  ["Vorrat", `${f.buffer} Bilder zusätzlich zum aktuellen`],
                ]}
              />
            )}
            <Link to={`/rahmen/${f.id}?ansicht=zeitplan`}>Im Zeitplan ansehen</Link>
          </Fold>

          <Fold
            title="Nach den Wechseln"
            summary={
              f.missedChanges
                ? `${plural(f.missedChanges, "Wechsel", "Wechsel")} verpasst`
                : neverChanged
                  ? "Noch keine Wechsel beobachtet"
                  : `Nach ${f.changeStats.online} von ${f.changeStats.watched} Wechseln gemeldet`
            }
            tone={f.missedChanges ? "bad" : undefined}
          >
            <p className="text-[15px] text-ink-soft">
              Nach jedem Wechsel meldet sich der Rahmen kurz im WLAN. Nur daran erkennt der Server, dass er das Bild gewechselt hat.
            </p>
            <ul className="m-0 grid list-none gap-1.5 p-0 text-[15px]">
              {f.changes.map((c) => (
                <li key={c.at} className="flex items-baseline gap-3">
                  <span className="w-28 shrink-0 text-ink-soft">{fmtWhen(c.at)}</span>
                  {c.onlineAfterSec !== null ? (
                    <span>
                      nach {c.onlineAfterSec} s gemeldet{c.battery !== null ? `, Akku ${c.battery} %` : ""}
                    </span>
                  ) : (
                    <span className="text-red">nicht gemeldet, Bild wahrscheinlich nicht gewechselt</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-small text-ink-soft">
              {neverChanged
                ? `Noch keine Wechsel beobachtet. Der erste ist ${fmtWhen(f.nextChange)}.`
                : `Nach ${f.changeStats.online} der letzten ${f.changeStats.watched} Wechsel hat er sich gemeldet.`}
            </p>
          </Fold>

          <Fold
            title={f.power === "dauerstrom" ? "Strom" : "Akku"}
            summary={f.battery ? `${f.battery.percent} %, ${powerLine(f)}` : "Dauerstrom, immer erreichbar"}
          >
            <Facts
              rows={[
                ["Betrieb", f.power === "dauerstrom" ? "Dauerstrom: immer erreichbar, Änderungen gehen sofort raus" : "Akku: schläft zwischen den Wechseln"],
                ...(f.battery
                  ? ([
                      ["Stand", `${f.battery.percent} %, gelesen ${fmtWhen(f.battery.at)}${f.charging ? ", lädt" : ""}`],
                      ...(f.charging || !f.battery.until
                        ? [["Reicht", f.charging ? "lädt gerade" : "unbekannt"]]
                        : [
                            [
                              f.battery.afterPending
                                ? `Beim aktuellen Rhythmus (${event ? everyText(event.everyMin) : cadenceText(f.cadence.deviceValue ?? f.cadence.value)})`
                                : "Reicht",
                              `voraussichtlich bis ${untilText(f.battery.until)}, etwa ${f.battery.changesLeft} Wechsel`,
                            ],
                          ]),
                      ...(f.battery.afterPending && !f.charging
                        ? [
                            [
                              `Nach Übernahme deiner Änderung (${cadenceText(f.battery.afterPending.cadence)})`,
                              `voraussichtlich bis ${untilText(f.battery.afterPending.until)}, etwa ${f.battery.afterPending.changesLeft} Wechsel`,
                            ],
                          ]
                        : []),
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
            {f.battery && (
              <p className="text-small text-ink-soft">
                {neverChanged
                  ? "Geschätzt aus dem eingestellten Rhythmus. Ein eigener Akku-Verlauf entsteht mit den ersten Wechseln."
                  : "Geschätzt aus dem Akku-Verlauf für den Rhythmus, den der Rahmen bestätigt hat."}{" "}
                Jeder Bildaufbau kostet Strom, das Hängen selbst fast nichts.
              </p>
            )}
            {f.batteryLog.length > 0 && (
              <ul className="m-0 grid list-none gap-1.5 p-0 text-[15px]" aria-label="Akku-Verlauf">
                {f.batteryLog.slice(0, 7).map((r) => (
                  <li key={r.at} className="grid grid-cols-[6.5rem_3rem_1fr] items-center gap-2">
                    <span className="text-ink-soft">{fmtWhen(r.at)}</span>
                    <span className="text-right">{r.percent} %</span>
                    <Meter percent={r.percent} />
                  </li>
                ))}
              </ul>
            )}
          </Fold>

          <Fold title="Schlaf" summary={sleepLine(f)} tone={f.lightSleep && !f.lightSleep.until ? "bad" : undefined}>
            <Facts
              rows={[
                ["Zustand", sleepLine(f)],
                ["Eingeschlafen", f.sleep.bySelf ? "von selbst, nach dem Laden der Bilder" : "vom Server schlafen geschickt"],
                ["Kontrolle", `alle ${f.checks.everyMin} Minuten, zuletzt ${fmtWhen(f.checks.last.at)}: ${f.checks.last.awake ? "wach" : "schläft"}`],
                ...(f.watching
                  ? ([["Knopfdruck", `Der Server schaut alle ${f.watching.everySec} Sekunden nach, bis ${fmtWhen(f.watching.until)}`]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
              ]}
            />
            {f.lightSleep && (
              <div className="grid gap-1 text-[15px]">
                <strong>Leichter Schlaf</strong>
                <p>
                  Von {fmtWhen(f.lightSleep.since)} bis {f.lightSleep.until ? fmtWhen(f.lightSleep.until) : "jetzt"} schlief der Rahmen, blieb aber im WLAN. Das
                  kostet viel Akku
                  {f.lightSleep.batteryFrom !== null && f.lightSleep.batteryTo !== null
                    ? `: in dieser Zeit fiel er von ${f.lightSleep.batteryFrom} % auf ${f.lightSleep.batteryTo} %.`
                    : "."}
                </p>
                <ul className="m-0 list-none p-0 text-ink-soft">
                  {f.lightSleep.tries.map((t) => (
                    <li key={t.at}>
                      {fmtWhen(t.at)}: {t.result}
                    </li>
                  ))}
                </ul>
                {f.lightSleep.gaveUp && (
                  <p>
                    Der Server konnte ihn nicht in den Tiefschlaf schicken. Hilft der Knopf nicht: Knopf halten, bis der Bildschirm weiß wird, dann wieder
                    einschalten.
                  </p>
                )}
              </div>
            )}
            {f.deepSleepAttempt && (
              <p className={cn("text-[15px]", !f.deepSleepAttempt.ok && "text-ink-soft")}>
                Letzter Tiefschlaf-Versuch {fmtWhen(f.deepSleepAttempt.at)}: {f.deepSleepAttempt.result}
              </p>
            )}
            {f.checks.foundAwake.length > 0 && (
              <div className="text-[15px]">
                <strong>Wach gefunden</strong>
                <ul className="m-0 list-none p-0 text-ink-soft">
                  {f.checks.foundAwake.map((w) => (
                    <li key={w.at}>
                      {fmtWhen(w.at)}
                      {w.battery !== null ? `, Akku ${w.battery} %${w.charging ? " (lädt)" : ""}` : ""}, {w.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Fold>

          <Fold
            title="Reinigung des Bildschirms"
            summary={
              cleaningPending
                ? `${f.cleaning.value} eingestellt, am Rahmen gilt noch ${f.cleaning.deviceValue ?? "der alte Wert"}`
                : `täglich um ${f.cleaning.value}`
            }
          >
            <p className="text-[15px] text-ink-soft">
              Einmal am Tag frischt der Rahmen seinen Bildschirm auf. Am besten ein paar Minuten vor dem ersten Wechsel am Morgen.
            </p>
            <Facts
              rows={[
                ["Eingestellt", `täglich um ${f.cleaning.value}`],
                ["Am Rahmen", <SettingMark key="m" confirmedAt={f.cleaning.confirmedAt} deviceValue={f.cleaning.deviceValue} />],
                ["Ruhezeit", `Von ${f.cleaningWindow.quietFrom} bis ${f.cleaningWindow.quietUntil} lässt der Server den Rahmen in Ruhe`],
                ["Zuletzt gelesen", f.cleaningWindow.readAt ? fmtWhen(f.cleaningWindow.readAt) : "noch nie"],
              ]}
            />
            <Link to={`/einstellungen/rahmen/${f.id}`}>Zeit ändern</Link>
          </Fold>

          <Fold title="Rahmen-Prüfung" summary={f.deviceCheck ? `zuletzt ${fmtAgo(f.deviceCheck.at)}, alles wie erwartet` : "Noch nicht geprüft"}>
            {f.deviceCheck ? (
              <Facts
                rows={[
                  ["Geprüft", fmtWhen(f.deviceCheck.at)],
                  ["Gerät", `${f.deviceCheck.name}, Firmware ${f.deviceCheck.firmware}`],
                  ["Netzwerk-Standby", f.deviceCheck.networkStandby],
                  ["Schlafen nach", f.deviceCheck.sleepAfter],
                  ["Schlaf nach Bild-Update", f.deviceCheck.sleepAfterUpdate],
                  ["Stromspar-WLAN", f.deviceCheck.lowPowerWifi],
                ]}
              />
            ) : (
              <p className="text-[15px] text-ink-soft">
                Noch nicht geprüft. Mit „Rahmen prüfen“ liest der Server Gerätename, Firmware und Schlaf-Einstellungen.
              </p>
            )}
            {f.setupTest && (
              <div className="grid gap-1.5 text-[15px]">
                <strong>Beim Hinzufügen {fmtWhen(f.setupTest.at)} geprüft</strong>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {f.setupTest.steps.map((s) => (
                    <li key={s.label} className="flex items-start gap-2">
                      {s.ok ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-green" aria-label="in Ordnung" />
                      ) : (
                        <X className="mt-0.5 size-4 shrink-0 text-red" aria-label="fehlgeschlagen" />
                      )}
                      <span>
                        {s.label}
                        {s.note && <span className="text-ink-soft">: {s.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Fold>

          <Fold title="Runde und Gruppe" summary={`${f.round.shown} von ${f.round.total} Bildern in dieser Runde gezeigt`}>
            <Facts
              rows={[
                [
                  "Gruppe",
                  group ? (
                    <Link key="g" to={`/gruppen/${group.id}`}>
                      {group.name}
                    </Link>
                  ) : (
                    "–"
                  ),
                ],
                ["Thema", group ? group.albums.join(", ") : "–"],
                ["Runde", `${f.round.n}. Runde, ${f.round.shown} von ${f.round.total} Bildern gezeigt oder vorgemerkt`],
              ]}
            />
            <p className="text-small text-ink-soft">Eine Runde ist zu Ende, wenn der Stapel leer ist. Dann wird neu gemischt.</p>
          </Fold>

          {f.lastProblem && (
            <Fold title="Letztes Problem" summary={fmtWhen(f.lastProblem.at)} tone="bad">
              <p className="text-[15px]">{f.lastProblem.text}</p>
            </Fold>
          )}

          <Fold title="Verlauf" summary={history.data?.[0] ? `zuletzt ${fmtWhen(history.data[0].at)}` : ""}>
            <ul className="m-0 grid list-none gap-2 p-0 text-[15px]">
              {history.data?.slice(0, 8).map((h) => (
                <li key={h.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                  <span className="text-ink-soft">{fmtWhen(h.at)}</span>
                  <HistoryLine entry={h} />
                </li>
              ))}
            </ul>
            <Link to={`/verlauf?rahmen=${f.id}`}>Ganzen Verlauf ansehen</Link>
          </Fold>
        </div>
      </Section>
    </>
  )
}

function BufferStrip({ frameId }: { frameId: string }) {
  const pictures = usePictureMap()
  const { data } = useTimeline(frameId)
  const onFrame = (data ?? []).filter((i) => i.state === "haengt" || i.state === "am-rahmen")
  return (
    <>
      {onFrame.map((i) => {
        const p = pictures.get(i.pictureId)
        return p ? (
          <figure key={i.pictureId} className="m-0 grid w-[68px] gap-1">
            <Thumb picture={p} byId={pictures} className="w-full" />
            <figcaption className="text-[12px] leading-tight text-ink-soft">{i.state === "haengt" ? "hängt" : fmtWhen(i.at)}</figcaption>
          </figure>
        ) : null
      })}
    </>
  )
}
