import { cn } from "cn"
import { Check, Loader2, Power, X } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { api } from "@/api"
import { useAct, useOverview } from "@/api/hooks"
import type { ConnectionTest, NewFrame, Orientation, PowerMode } from "@/api/types"
import { Banner, Field, PageHead, SettingRow } from "@/components/bits"
import { Segmented } from "@/components/segmented"
import { TestCard } from "@/components/test-card"
import { TimeField } from "@/components/time-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { firstChangeAfter, suggestedCleaning } from "@/lib/cadence"
import { now } from "@/lib/clock"
import { fmtWhen } from "@/lib/format"
import { CadenceFields } from "./frame-settings"

const STEPS = ["Angaben", "Am Rahmen und im Netz", "Verbinden"]

/** What has to be set outside this page. A frame on mains power must stay awake, a battery frame must sleep. */
function checklist(power: PowerMode, ip: string): { id: string; where: string; text: string }[] {
  return [
    { id: "ausrichtung", where: "Samsung-App", text: "Ausrichtung des Bildschirms so einstellen, wie der Rahmen hängt" },
    ...(power === "dauerstrom"
      ? [
          {
            id: "netzwerk-standby",
            where: "Samsung-App",
            text: "Netzwerk-Standby einschalten. Der Rahmen bleibt erreichbar, damit Änderungen sofort ankommen.",
          },
        ]
      : [
          { id: "tiefschlaf", where: "Samsung-App", text: "Energiesparmodus auf „Tiefschlaf“ stellen" },
          { id: "schlaf-nach-update", where: "Samsung-App", text: "„Nach Inhaltsaktualisierung schlafen“ einschalten" },
        ]),
    { id: "feste-ip", where: "UniFi", text: `Dem Rahmen die feste IP-Adresse ${ip} geben` },
    { id: "regel", where: "UniFi", text: `${ip} in die Regel „Allow Kub to EM32DX frames (MDC)“ aufnehmen` },
  ]
}
const COUNT_WORD = ["null", "eine", "zwei", "drei", "vier", "fünf", "sechs"]

export function AddFrameScreen() {
  const navigate = useNavigate()
  const { data: overview } = useOverview()
  const [step, setStep] = useState(0)
  const count = overview?.frames.length ?? 0
  const [frame, setFrame] = useState<NewFrame>({
    name: "",
    device: "",
    ip: "",
    orientation: "hoch",
    upsideDown: false,
    power: "akku",
    cadence: { everyMin: 1440, at: "07:00" },
    cleaning: "06:50",
    buffer: 3,
    groupId: "",
    pin: null,
  })
  const [ownPin, setOwnPin] = useState(false)
  const [cleaningTouched, setCleaningTouched] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [test, setTest] = useState<ConnectionTest | null>(null)
  const runTest = useAct((ip: string) => api.testConnection(ip, frame.power))
  const add = useAct(api.addFrame, () => `${frame.name} hinzugefügt`)
  const patch = (p: Partial<NewFrame>) =>
    setFrame((f) => {
      const next = { ...f, ...p }
      if (p.cadence && !cleaningTouched) next.cleaning = suggestedCleaning(p.cadence)
      return next
    })

  const mains = frame.power === "dauerstrom"
  const list = checklist(frame.power, frame.ip)
  const done = list.filter((c) => checked.includes(c.id)).length
  const device = frame.device || `Frame ${count + 1}`
  const groupId = frame.groupId || overview?.groups[0]?.id || ""
  const ipOk = /^\d{1,3}(\.\d{1,3}){3}$/.test(frame.ip)
  const step1Ok = frame.name.trim() && ipOk && groupId && (!ownPin || frame.pin)
  const full: NewFrame = { ...frame, device, groupId, name: frame.name.trim(), pin: ownPin ? frame.pin : null }
  // The same first change everywhere: on the card, in the sentence, and on the frame's page afterwards.
  const firstChange = firstChangeAfter(now(), frame.cadence)
  // A battery frame falls asleep again about a minute and a half after its button was pressed.
  const asleepAgain = !mains && !!test?.awakeUntil && test.awakeUntil <= now()

  return (
    <div className="grid gap-7">
      <PageHead title="Rahmen hinzufügen" back={{ to: "/einstellungen", label: "Einstellungen" }} />

      <ol className="m-0 flex list-none gap-2 p-0" aria-label="Schritte">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "grid flex-1 gap-1.5 border-t-[3px] pt-2 text-small",
              i <= step ? "border-ink" : "border-line text-ink-soft",
              i === step && "font-semibold",
            )}
          >
            <span>
              {i + 1}. {s}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-6">
          <Field label="Wo hängt er?" htmlFor="neu-name" hint="Ein Name, unter dem ihn jeder im Haus erkennt.">
            <Input id="neu-name" value={frame.name} placeholder="Kinderzimmer" onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <div className="grid gap-4 min-[560px]:grid-cols-2">
            <Field label="Gerätename" htmlFor="neu-geraet" hint="Wie in der Samsung-App.">
              <Input id="neu-geraet" value={frame.device} placeholder={`Frame ${count + 1}`} onChange={(e) => patch({ device: e.target.value })} />
            </Field>
            <Field
              label="Feste IP-Adresse"
              htmlFor="neu-ip"
              error={frame.ip && !ipOk ? "Vier Zahlen mit Punkten, zum Beispiel 192.168.10.68" : undefined}
              hint="Vergibst du im nächsten Schritt in UniFi."
            >
              <Input
                id="neu-ip"
                inputMode="decimal"
                value={frame.ip}
                placeholder="192.168.10.68"
                onChange={(e) => patch({ ip: e.target.value.trim() })}
                aria-invalid={!!frame.ip && !ipOk}
              />
            </Field>
          </div>
          <Field
            label="Geräte-PIN"
            htmlFor="neu-pin"
            hint={ownPin ? "Wird verschlüsselt gespeichert und nie wieder angezeigt." : "Die PIN aus der Samsung-App. Meist haben alle Rahmen dieselbe."}
          >
            {ownPin ? (
              <div className="flex gap-2">
                <Input
                  id="neu-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={frame.pin ?? ""}
                  onChange={(e) => patch({ pin: e.target.value })}
                  placeholder="PIN dieses Rahmens"
                  className="max-w-[220px]"
                />
                <Button variant="ghost" onClick={() => setOwnPin(false)}>
                  Doch wie bei den anderen
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-control bg-sunken px-4 py-2.5">
                <span className="flex-1">Wie bei den anderen Rahmen</span>
                <Button id="neu-pin" variant="outline" size="sm" onClick={() => setOwnPin(true)}>
                  Andere PIN eingeben
                </Button>
              </div>
            )}
          </Field>
          <div className="grid gap-2">
            <span className="font-semibold">Wie hängt er?</span>
            <Segmented<Orientation>
              label="Format"
              value={frame.orientation}
              onChange={(v) => patch({ orientation: v })}
              options={[
                { value: "hoch", label: "Hochformat" },
                { value: "quer", label: "Querformat" },
              ]}
            />
            <SettingRow title="Auf dem Kopf montiert" text="Um 180° gedreht, zum Beispiel damit das Kabel nach oben weggeht.">
              <Switch checked={frame.upsideDown} onCheckedChange={(v) => patch({ upsideDown: v })} aria-label="Auf dem Kopf montiert" />
            </SettingRow>
          </div>
          <div className="grid gap-2">
            <span className="font-semibold">Strom</span>
            <Segmented<PowerMode>
              label="Stromversorgung"
              value={frame.power}
              onChange={(v) => patch({ power: v })}
              options={[
                { value: "akku", label: "Akku", note: "schläft zwischen den Wechseln" },
                { value: "dauerstrom", label: "Dauerstrom", note: "immer erreichbar" },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <span className="font-semibold">Wechselrhythmus</span>
            <CadenceFields value={frame.cadence} onChange={(c) => patch({ cadence: c })} power={frame.power} />
          </div>
          <div className="grid gap-4 min-[560px]:grid-cols-2">
            <Field label="Reinigung des Bildschirms" htmlFor="neu-reinigung" hint="Vorschlag: zehn Minuten vor dem ersten Wechsel.">
              <TimeField
                id="neu-reinigung"
                label="Reinigung des Bildschirms"
                value={frame.cleaning}
                onChange={(v) => {
                  setCleaningTouched(true)
                  patch({ cleaning: v })
                }}
              />
            </Field>
            <Field label="Bilder auf Vorrat" hint="Zusätzlich zum aktuellen Bild.">
              <Segmented
                label="Bilder auf Vorrat"
                value={String(frame.buffer)}
                onChange={(v) => patch({ buffer: Number(v) })}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </Field>
          </div>
          <Field label="Gruppe" hint="Bestimmt, aus welchen Alben der Rahmen Bilder bekommt.">
            <Select value={groupId} onValueChange={(v) => patch({ groupId: v })}>
              <SelectTrigger className="h-11 w-full bg-surface text-body" aria-label="Gruppe">
                <SelectValue placeholder="Gruppe wählen" />
              </SelectTrigger>
              <SelectContent>
                {overview?.groups.map((g) => (
                  <SelectItem key={g.id} value={g.id} className="py-2 text-body">
                    {g.name} ({g.albums.join(", ")})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button disabled={!step1Ok} onClick={() => setStep(1)}>
              Weiter
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/einstellungen">Abbrechen</Link>
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-5">
          <p className="max-w-[62ch]">
            Diese {COUNT_WORD[list.length]} Dinge stellst du außerhalb dieser Seite ein: in der Samsung-App und in UniFi.{" "}
            {mains
              ? "Ohne sie findet der Server den Rahmen nicht, oder er schläft ein und Änderungen kommen nicht sofort an."
              : "Ohne sie findet der Server den Rahmen nicht, oder der Akku ist in wenigen Tagen leer."}{" "}
            Hak ab, was erledigt ist.
          </p>
          <ul className="m-0 list-none p-0 [&>li:last-child]:border-b">
            {list.map((c) => (
              <li key={c.id} className="border-t border-line">
                <label className="flex min-h-14 items-center gap-3 py-2">
                  <Checkbox
                    className="size-6"
                    checked={checked.includes(c.id)}
                    onCheckedChange={(v) => setChecked((cur) => (v === true ? [...cur, c.id] : cur.filter((x) => x !== c.id)))}
                  />
                  <span className="grid">
                    <span className="text-small text-ink-soft">{c.where}</span>
                    <span>{c.text}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button disabled={done < list.length} onClick={() => setStep(2)}>
              Weiter
            </Button>
            <Button variant="outline" onClick={() => setStep(0)}>
              Zurück
            </Button>
          </div>
          {done < list.length && <p className="-mt-2 text-small text-ink-soft">Noch {list.length - done} offen.</p>}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-5">
          {mains ? (
            <Banner level="wait" icon={Power} title="Der Rahmen muss eingeschaltet sein">
              <p>Am Strom und mit Netzwerk-Standby ist er immer erreichbar. Zeigt er nichts an, drück einmal den Knopf am Rahmen.</p>
            </Banner>
          ) : (
            <Banner level="wait" icon={Power} title="Drück jetzt den Knopf am Rahmen">
              <p>Der Rahmen ist dann etwa anderthalb Minuten wach. In dieser Zeit „Verbindung testen“ antippen.</p>
            </Banner>
          )}
          <Button
            className="w-fit"
            disabled={runTest.isPending}
            onClick={() => {
              setTest(null)
              runTest.mutate(frame.ip, { onSuccess: setTest })
            }}
          >
            {runTest.isPending && <Loader2 className="animate-spin" />}
            {runTest.isPending ? `Sucht ${frame.ip} …` : test ? "Noch einmal testen" : "Verbindung testen"}
          </Button>
          {test && (
            <ul className="m-0 grid list-none gap-2 p-0" aria-live="polite">
              {test.steps.map((s) => (
                <li key={s.label} className="flex items-start gap-3">
                  {s.ok ? (
                    <Check className="mt-0.5 size-5 text-green" aria-label="in Ordnung" />
                  ) : (
                    <X className="mt-0.5 size-5 text-red" aria-label="fehlgeschlagen" />
                  )}
                  <span className={s.ok ? "" : "font-semibold text-red"}>
                    {s.label}
                    {s.note && <span className="block text-small font-normal text-ink-soft">{s.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {test?.ok && (
            <div className="grid gap-2 rounded-control bg-sunken p-4">
              <p>
                {mains ? (
                  <>
                    {frame.name} wird hinzugefügt und zeigt in wenigen Sekunden sein <strong>Erkennungsbild</strong>.
                  </>
                ) : asleepAgain ? (
                  <>
                    {frame.name} wird hinzugefügt. Der Rahmen schläft inzwischen wieder: sein <strong>Erkennungsbild</strong> kommt an, sobald du noch einmal
                    den Knopf am Rahmen drückst.
                  </>
                ) : (
                  <>
                    {frame.name} wird hinzugefügt und zeigt sein <strong>Erkennungsbild</strong>, solange er vom Knopfdruck noch wach ist. Schläft er schon
                    wieder, kommt es beim nächsten Druck auf den Knopf an.
                  </>
                )}{" "}
                Daran siehst du, dass der richtige Rahmen richtig herum hängt.
              </p>
              <p>
                Erkennungsbild bis {fmtWhen(firstChange)}. Danach beginnt dein normaler Zeitplan{mains ? "" : " mit dem ersten Bild"}.
              </p>
              <TestCard
                kind="erkennungsbild"
                frame={{ name: frame.name, device, ip: frame.ip, orientation: frame.orientation }}
                groupName={overview?.groups.find((g) => g.id === groupId)?.name ?? ""}
                from={now()}
                until={firstChange}
                className={frame.orientation === "hoch" ? "w-[150px]" : "w-[260px] max-w-full"}
              />
              <Button className="w-fit" disabled={add.isPending} onClick={() => add.mutate(full, { onSuccess: (r) => navigate(`/rahmen/${r.id}`) })}>
                Hinzufügen und Erkennungsbild zeigen
              </Button>
            </div>
          )}
          {test && !test.ok && (
            <p className="text-[15px]">
              Prüf die markierte Stelle und teste noch einmal.{mains ? "" : " Der Rahmen muss dafür wach sein: notfalls den Knopf erneut drücken."}
            </p>
          )}
          <Button variant="outline" className="w-fit" onClick={() => setStep(1)}>
            Zurück
          </Button>
        </div>
      )}
    </div>
  )
}
