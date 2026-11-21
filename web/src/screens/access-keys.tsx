import { Lock } from "lucide-react"
import { useState } from "react"
import { api } from "@/api"
import { useAct, useKeys, useSettings } from "@/api/hooks"
import type { AccessKey } from "@/api/types"
import { Field, PageHead } from "@/components/bits"
import { StateMark } from "@/components/marks"
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
import { Skeleton } from "@/components/ui/skeleton"
import { fmtWhen } from "@/lib/format"

const STATUS: Record<AccessKey["status"], { level: "ok" | "bad" | "off"; text: string }> = {
  funktioniert: { level: "ok", text: "funktioniert" },
  "funktioniert-nicht": { level: "bad", text: "funktioniert nicht mehr" },
  fehlt: { level: "off", text: "fehlt" },
}

function KeyCard({ k }: { k: AccessKey }) {
  const [value, setValue] = useState("")
  const [replacing, setReplacing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const save = useAct(
    async ({ id, key }: { id: AccessKey["id"]; key: string }) => {
      await api.saveKey(id, key)
      return api.testKey(id)
    },
    (r) => `Schlüssel gespeichert. ${r.name}: ${STATUS[r.status].text}`,
  )
  const test = useAct(api.testKey, (r) => (r.status === "funktioniert" ? `${r.name}: funktioniert` : `${r.name}: ${STATUS[r.status].text}`))
  const remove = useAct(api.removeKey, "Schlüssel entfernt")
  const status = STATUS[k.status]
  const locked = k.source === "infisical"
  const showField = !locked && (!k.saved || replacing)

  return (
    <section className="grid gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-baseline gap-2">
          {k.name}
          {k.later && <span className="rounded-full border border-dashed border-ink-soft px-2 text-small font-normal text-ink-soft">später</span>}
        </h2>
        <StateMark level={status.level}>{status.text}</StateMark>
      </div>
      <p className="text-[15px]">{k.purpose}.</p>
      {k.id === "immich" && (
        <p className="text-small text-ink-soft">
          Benötigte Rechte in Immich: <code>album.read</code>, <code>asset.read</code>, <code>asset.view</code>, <code>asset.download</code> und optional{" "}
          <code>person.read</code> (für die Personen-Auswahl).
        </p>
      )}
      {k.later && <p className="text-[15px] text-ink-soft">Wird noch von nichts benutzt. Du kannst den Schlüssel schon hinterlegen.</p>}
      <p className="text-small text-ink-soft">
        {k.statusNote}
        {k.testedAt ? `. Zuletzt geprüft ${fmtWhen(k.testedAt)}` : ""}
      </p>

      {locked ? (
        <div className="flex items-start gap-3 rounded-control bg-sunken px-4 py-3 text-[15px]">
          <Lock className="mt-0.5 size-5 shrink-0 text-ink-soft" aria-hidden />
          <span>
            <strong>Aus Infisical.</strong> Der Schlüssel kommt aus der Server-Einrichtung und lässt sich hier weder ansehen noch ändern. Zum Tauschen den Wert
            in Infisical ersetzen.
          </span>
        </div>
      ) : showField ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!value.trim()) return
            save.mutate(
              { id: k.id, key: value.trim() },
              {
                onSuccess: () => {
                  setValue("")
                  setReplacing(false)
                },
              },
            )
          }}
        >
          <Field
            label={k.saved ? "Neuer Schlüssel" : "Schlüssel"}
            htmlFor={`key-${k.id}`}
            hint="Nach dem Speichern wird der Schlüssel nie wieder angezeigt, auch dir nicht. Er liegt verschlüsselt auf dem Server."
          >
            <Input
              id={`key-${k.id}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Schlüssel hier einfügen"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!value.trim() || save.isPending}>
              {save.isPending ? "Speichert …" : "Speichern und testen"}
            </Button>
            {replacing && (
              <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                Abbrechen
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3 rounded-control bg-sunken px-4 py-3 text-[15px]">
          <span aria-hidden className="tracking-[0.2em] text-ink-soft">
            ••••••••••••
          </span>
          <strong>gespeichert</strong>
          <span className="text-ink-soft">lässt sich nicht mehr anzeigen</span>
        </div>
      )}

      {k.saved && !showField && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate(k.id)}>
            {test.isPending ? "Testet …" : "Testen"}
          </Button>
          {!locked && (
            <>
              <Button variant="outline" onClick={() => setReplacing(true)}>
                Ersetzen
              </Button>
              <Button variant="ghost" className="text-red" disabled={remove.isPending} onClick={() => setConfirmRemove(true)}>
                Entfernen
              </Button>
            </>
          )}
        </div>
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent className="bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Schlüssel für {k.name} entfernen?</AlertDialogTitle>
            <AlertDialogDescription className="text-body text-ink">
              Danach kannst du ihn nur erneut eintragen. Was den Schlüssel braucht, funktioniert bis dahin nicht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Behalten</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate(k.id)}>
              Schlüssel entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

export function AccessKeysScreen() {
  const { data } = useKeys()
  const settings = useSettings()
  const [url, setUrl] = useState<string | null>(null)
  const saveUrl = useAct((immichUrl: string) => api.updateSettings({ immichUrl }), "Immich-Adresse gespeichert")
  return (
    <div className="grid gap-6">
      <PageHead
        title="Zugänge"
        back={{ to: "/einstellungen", label: "Einstellungen" }}
        lead="Schlüssel, mit denen sich der Server bei anderen Diensten anmeldet. Einmal gespeichert, ist ein Schlüssel hier nicht mehr lesbar: nur ersetzen oder entfernen."
      />
      <Field label="Immich-Adresse mit /api" htmlFor="immich-url">
        <Input
          id="immich-url"
          value={url ?? settings.data?.immichUrl ?? ""}
          disabled={settings.data?.immichUrlLocked}
          onChange={(e) => setUrl(e.target.value)}
        />
        {!settings.data?.immichUrlLocked && (
          <Button variant="outline" disabled={!url || saveUrl.isPending} onClick={() => url && saveUrl.mutate(url)}>
            Adresse speichern
          </Button>
        )}
      </Field>
      {settings.data?.localSecretsKey && (
        <p className="text-small text-ink-soft">
          Der Verschlüsselungsschlüssel liegt im Datenordner. Sichere ihn zusammen mit den Daten. Ein externer SECRETS_KEY kann ihn bei einer neuen Einrichtung
          ersetzen.
        </p>
      )}
      {!data ? <Skeleton className="h-48 w-full" /> : data.map((k) => <KeyCard key={k.id} k={k} />)}
      <p className="border-t border-line pt-5 text-[15px] text-ink-soft">
        Die Seite selbst hat kein Passwort: im Heimnetz darf sie jeder benutzen. Die Geräte-PIN der Rahmen steht bei jedem Rahmen in dessen Einstellungen.
      </p>
    </div>
  )
}
