import { Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router"
import { api } from "@/api"
import { useAct, useFrame, useOverview, usePending } from "@/api/hooks"
import type { Cadence, Frame, PowerMode } from "@/api/types"
import { Field, Hint, PageHead, Section, SettingRow } from "@/components/bits"
import { SettingState, UnsavedMark } from "@/components/marks"
import { PendingQueue } from "@/components/pending-queue"
import { Segmented } from "@/components/segmented"
import { TimeField } from "@/components/time-field"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { CADENCE_CHOICES, cadenceText, suggestedCleaning } from "@/lib/cadence"
import { settingSentence } from "@/lib/explain"
import { plural } from "@/lib/format"

/** Rhythm and time of the first change, with what it costs a battery frame. */
export function CadenceFields({ value, onChange, power }: { value: Cadence; onChange: (c: Cadence) => void; power: PowerMode }) {
  const perDay = Math.round(((1440 / value.everyMin) * 0.6 + 0.25) * 10) / 10
  const changesPerDay = 1440 / value.everyMin
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Select value={String(value.everyMin)} onValueChange={(v) => onChange({ ...value, everyMin: Number(v) })}>
          <SelectTrigger className="h-11 w-[200px] bg-surface text-body" aria-label="Wie oft wechseln">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CADENCE_CHOICES.map((c) => (
              <SelectItem key={c.everyMin} value={String(c.everyMin)} className="py-2 text-body">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 text-[15px] text-ink-soft">
          <span aria-hidden>{value.everyMin >= 720 ? "um" : "erster Wechsel um"}</span>
          <TimeField label={value.everyMin >= 720 ? "Wechsel um" : "Erster Wechsel um"} value={value.at} onChange={(at) => onChange({ ...value, at })} />
        </div>
      </div>
      <p className="text-small text-ink-soft">
        {power === "akku"
          ? `${changesPerDay >= 1 ? plural(Math.round(changesPerDay), "Bildaufbau", "Bildaufbauten") : "Ein Bildaufbau alle paar"} ${changesPerDay >= 1 ? "am Tag" : "Tage"}: kostet etwa ${String(perDay).replace(".", ",")} % Akku am Tag. Ein voller Akku hält damit rund ${Math.round(100 / perDay)} Tage.`
          : "Am Strom spielt der Rhythmus für den Verbrauch keine Rolle."}
      </p>
    </div>
  )
}

export function FrameSettingsScreen() {
  const { id = "" } = useParams()
  const { data: f } = useFrame(id)
  if (!f) return <Skeleton className="h-64 w-full" />
  return <FrameSettingsForm f={f} key={f.id} />
}

function FrameSettingsForm({ f }: { f: Frame }) {
  const navigate = useNavigate()
  const { data: overview } = useOverview()
  const pending = usePending(f.id)
  const [name, setName] = useState(f.name)
  const [cadence, setCadence] = useState<Cadence | null>(null)
  const [cleaning, setCleaning] = useState<string | null>(null)
  const [buffer, setBuffer] = useState<number | null>(null)
  const [pin, setPin] = useState("")
  const [confirmRemove, setConfirmRemove] = useState(false)
  const now = useAct((patch: Parameters<typeof api.updateFrame>[1]) => api.updateFrame(f.id, patch))
  const later = useAct(
    (patch: Parameters<typeof api.updateFrame>[1]) => api.updateFrame(f.id, patch),
    () => (f.nextOnline.immediate ? "Gespeichert, geht sofort an den Rahmen" : "Eingestellt. Wartet auf den Rahmen"),
  )
  const pinSave = useAct(
    (patch: Parameters<typeof api.updateFrame>[1]) => api.updateFrame(f.id, patch),
    "PIN ersetzt. Sie wird beim nächsten Melden des Rahmens benutzt",
  )
  const remove = useAct(() => api.removeFrame(f.id), `${f.name} entfernt`)

  // Coming from "Korrigieren": go straight to the setting that is to be corrected.
  const { hash } = useLocation()
  useEffect(() => {
    const field = hash ? document.getElementById(hash.slice(1)) : null
    field?.scrollIntoView({ block: "center" })
    field?.querySelector<HTMLElement>("button, [role=spinbutton], [role=radio]")?.focus({ preventScroll: true })
  }, [hash])

  const c = cadence ?? f.cadence.value
  const cl = cleaning ?? f.cleaning.value
  const b = buffer ?? f.buffer
  // A value changed on this page and not saved yet: the confirmation under it belongs to the saved value, not to this one.
  const cadenceDirty = !!cadence && JSON.stringify(cadence) !== JSON.stringify(f.cadence.value)
  const cleaningDirty = !!cleaning && cleaning !== f.cleaning.value
  const bufferDirty = buffer !== null && buffer !== f.buffer
  const changed = [cadenceDirty && "Wechselrhythmus", cleaningDirty && "Reinigung", bufferDirty && "Vorrat"].filter(Boolean) as string[]
  const suggestion = suggestedCleaning(c)
  const open = (pending.data ?? []).filter((p) => p.state !== "bestaetigt")

  return (
    <div className="grid gap-8">
      <PageHead title={`${f.name} einrichten`} back={{ to: "/einstellungen", label: "Einstellungen" }} />

      {open.length > 0 && <PendingQueue frame={f} changes={pending.data ?? []} compact />}

      <Section title="Ort und Gruppe">
        <Field label="Name des Ortes" htmlFor="rahmen-name" hint={`Gerät: ${f.device}, ${f.ip}. ${f.orientation === "hoch" ? "Hochformat" : "Querformat"}.`}>
          <Input
            id="rahmen-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== f.name && now.mutate({ name: name.trim() })}
          />
        </Field>
        <Field label="Gruppe" hint="Die Gruppe bestimmt, aus welchen Alben dieser Rahmen Bilder bekommt. Gilt ab den nächsten Bildern, die er lädt.">
          <Select value={f.groupId} onValueChange={(v) => now.mutate({ groupId: v })}>
            <SelectTrigger className="h-11 w-full bg-surface text-body" aria-label="Gruppe">
              <SelectValue />
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
      </Section>

      <Section title="Strom">
        <Segmented<PowerMode>
          label="Stromversorgung"
          value={f.power}
          onChange={(v) => now.mutate({ power: v })}
          options={[
            { value: "akku", label: "Akku", note: "schläft zwischen den Wechseln" },
            { value: "dauerstrom", label: "Dauerstrom", note: "immer erreichbar" },
          ]}
        />
        <p className="text-[15px] text-ink-soft">
          {f.power === "akku"
            ? "Änderungen warten, bis sich der Rahmen meldet. Der Akku-Stand und wie lange er reicht werden angezeigt."
            : "Änderungen gehen sofort raus, „Jetzt zeigen“ dauert Sekunden. Kein Akku-Stand. Nur wählen, wenn der Rahmen wirklich dauerhaft am Netzteil hängt."}
        </p>
      </Section>

      <Section
        title="Am Rahmen"
        aside={
          <Hint>
            {f.nextOnline.immediate
              ? "Diese drei Dinge muss der Rahmen selbst übernehmen. Er ist immer erreichbar: nach dem Speichern gehen sie sofort raus und stehen unter „Änderungen für diesen Rahmen“, bis er sie bestätigt hat."
              : "Diese drei Dinge muss der Rahmen selbst übernehmen. Nach dem Speichern warten sie, bis er sich meldet, und stehen so lange unter „Änderungen für diesen Rahmen“."}
          </Hint>
        }
      >
        <div className="grid gap-6">
          <div id="rhythmus" tabIndex={-1} className="grid scroll-mt-6 gap-2 outline-none">
            <span className="font-semibold">Wechselrhythmus</span>
            <CadenceFields value={c} onChange={setCadence} power={f.power} />
            <SettingState
              dirty={cadenceDirty}
              confirmedAt={f.cadence.confirmedAt}
              saved={cadenceText(f.cadence.value)}
              deviceValue={f.cadence.deviceValue ? cadenceText(f.cadence.deviceValue) : undefined}
            />
          </div>
          <div id="reinigung" tabIndex={-1} className="grid scroll-mt-6 gap-2 outline-none">
            <span className="font-semibold">Reinigung des Bildschirms</span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-[15px] text-ink-soft">
                <span aria-hidden>täglich um</span>
                <TimeField label="Reinigung des Bildschirms, täglich um" value={cl} onChange={setCleaning} />
              </div>
              {cl !== suggestion && (
                <Button variant="ghost" size="sm" onClick={() => setCleaning(suggestion)}>
                  Vorschlag {suggestion} nehmen
                </Button>
              )}
            </div>
            <p className="text-small text-ink-soft">
              Einmal am Tag frischt der Rahmen seinen Bildschirm auf. Am besten zehn Minuten vor dem ersten Wechsel, dann ist das neue Bild sauber.
            </p>
            <SettingState dirty={cleaningDirty} confirmedAt={f.cleaning.confirmedAt} saved={f.cleaning.value} deviceValue={f.cleaning.deviceValue} />
          </div>
          <div id="vorrat" tabIndex={-1} className="grid scroll-mt-6 gap-2 outline-none">
            <span className="font-semibold">Bilder auf Vorrat</span>
            <Segmented
              label="Bilder auf Vorrat"
              value={String(b)}
              onChange={(v) => setBuffer(Number(v))}
              className="w-fit min-w-[260px]"
              options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
            />
            <p className="text-small text-ink-soft">
              So viele Bilder liegen zusätzlich zum aktuellen am Rahmen. Mehr Vorrat überbrückt längere Ausfälle des Servers, bindet aber mehr Bilder an diesen
              Rahmen.
            </p>
            {bufferDirty && (
              <span className="grid gap-1">
                <UnsavedMark />
                <span className="text-small text-ink-soft">
                  Gespeichert: <strong className="font-semibold text-ink">{plural(f.buffer, "Bild", "Bilder")}</strong>
                </span>
              </span>
            )}
          </div>
        </div>
        {changed.length > 0 && (
          <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] grid gap-2 rounded-control border border-blue bg-surface p-3 min-[900px]:bottom-4">
            <p className="text-[15px]">{settingSentence(f, changed.join(", "))}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={later.isPending}
                onClick={() =>
                  later.mutate(
                    { cadence: cadence ?? undefined, cleaning: cleaning ?? undefined, buffer: buffer ?? undefined },
                    {
                      onSuccess: () => {
                        setCadence(null)
                        setCleaning(null)
                        setBuffer(null)
                      },
                    },
                  )
                }
              >
                Speichern
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCadence(null)
                  setCleaning(null)
                  setBuffer(null)
                }}
              >
                Verwerfen
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Montage und Zugang">
        <SettingRow title="Auf dem Kopf montiert" text="Der Rahmen hängt um 180° gedreht. Bilder werden dann gedreht geladen. Gilt ab den nächsten Bildern.">
          <Switch checked={f.upsideDown} onCheckedChange={(v) => now.mutate({ upsideDown: v })} aria-label="Auf dem Kopf montiert" />
        </SettingRow>
        <Field label="Geräte-PIN" htmlFor="pin" hint="Gespeichert, wie bei den anderen Rahmen. Die PIN lässt sich nicht anzeigen, nur ersetzen.">
          <div className="flex gap-2">
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Neue PIN eingeben"
              className="max-w-[220px]"
            />
            <Button
              variant="outline"
              disabled={!pin}
              onClick={() => {
                pinSave.mutate({ pin }, { onSuccess: () => setPin("") })
              }}
            >
              Ersetzen
            </Button>
          </div>
        </Field>
      </Section>

      <Section title="Rahmen entfernen">
        <p className="text-[15px]">
          Der Rahmen verschwindet aus dieser Seite. Sein letztes Bild bleibt auf dem Bildschirm stehen, auch ohne Strom. Die für ihn vorgemerkten Bilder gehen
          zurück in den Stapel.
        </p>
        <Button variant="destructive" className="w-fit" onClick={() => setConfirmRemove(true)}>
          <Trash2 />
          Rahmen entfernen
        </Button>
      </Section>

      <p className="text-[15px]">
        <Link to={`/rahmen/${f.id}`}>Zum Rahmen</Link>
      </p>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent className="bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>{f.name} entfernen?</AlertDialogTitle>
            <AlertDialogDescription className="text-body text-ink">
              {f.device} ({f.ip}) bekommt dann keine Bilder mehr. Seine {plural(f.bufferLeft, "vorgemerkte Bild geht", "vorgemerkten Bilder gehen")} zurück in
              den Stapel
              {f.pendingCount ? `, ${plural(f.pendingCount, "wartende Änderung verfällt", "wartende Änderungen verfallen")}` : ""}. Wieder hinzufügen geht nur
              über „Rahmen hinzufügen“.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Behalten</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate(undefined, { onSuccess: () => navigate("/einstellungen") })}>
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
