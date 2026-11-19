import { useQuery } from "@tanstack/react-query"
import { TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { api } from "@/api"
import { useAct } from "@/api/hooks"
import { useFrameMap, usePictureMap } from "@/api/lookups"
import type { ShowPlan, ShowRequest, ShowWhen } from "@/api/types"
import { Thumb } from "@/components/picture"
import { Segmented } from "@/components/segmented"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { nextNote, showItemWhen, showSentence } from "@/lib/explain"
import { fmtWhen, listDe } from "@/lib/format"

function warningText(w: ShowPlan["warnings"][number], frameName: string): string {
  if (w.reason === "haengt") return `Hängt gerade: ${frameName}`
  if (w.reason === "vorgemerkt") return `Ist schon vorgemerkt: ${frameName}`
  return `Hing eben erst: ${frameName}${w.at ? `, bis ${fmtWhen(w.at)}` : ""}`
}

/**
 * "Zeigen": when (Jetzt / Als Nächstes) and where (one frame / the whole house).
 * Says what will happen on which frame before anything is sent.
 */
export function ShowSheet({
  pictureIds,
  open,
  onOpenChange,
  frameId,
}: {
  pictureIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The frame to offer first, when the sheet is opened from a frame's page. */
  frameId?: string
}) {
  const frames = useFrameMap()
  const pictures = usePictureMap()
  const [when, setWhen] = useState<ShowWhen>("naechstes")
  const [where, setWhere] = useState<"rahmen" | "haus">("rahmen")
  const [target, setTarget] = useState(frameId ?? "")

  const first = pictures.get(pictureIds[0] ?? "")
  const fitting = [...frames.values()].filter((f) =>
    pictureIds.some((id) => {
      const p = pictures.get(id)
      return p && (p.orientation === f.orientation || p.alsoOther)
    }),
  )

  // Opening the sheet starts fresh; the first fitting frame is offered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the sheet opens
  useEffect(() => {
    if (!open) return
    setTarget((t) => frameId ?? (fitting.some((f) => f.id === t) ? t : (fitting[0]?.id ?? "")))
  }, [open])

  const request: ShowRequest = { pictureIds, when, scope: where === "haus" ? "haus" : { frameId: target }, force: false }
  const ready = open && pictureIds.length > 0 && (where === "haus" || !!target)
  const plan = useQuery({ queryKey: ["plan-show", request], queryFn: () => api.planShow(request), enabled: ready })
  const warned = (plan.data?.warnings.length ?? 0) > 0
  // With a warning there are two ways on: the full plan is shown for "Trotzdem zeigen" before the decision.
  const forced: ShowRequest = { ...request, force: true }
  const forcedPlan = useQuery({ queryKey: ["plan-show", forced], queryFn: () => api.planShow(forced), enabled: ready && warned })
  const preview = warned ? forcedPlan.data : plan.data
  const show = useAct(api.show, (result) => {
    const names = result.lines.map((l) => frames.get(l.frameId)?.name ?? "")
    return names.length ? `Eingestellt für ${listDe(names)}` : undefined
  })
  const run = (r: ShowRequest) => show.mutate(r, { onSuccess: () => onOpenChange(false) })

  const many = pictureIds.length > 1
  const nothing = preview && preview.lines.length === 0
  const others = plan.data?.lines.reduce((n, l) => n + l.pictureIds.length, 0) ?? 0
  const targets = where === "haus" ? fitting : fitting.filter((f) => f.id === target)
  const warnedIds = new Set(plan.data?.warnings.map((w) => w.pictureId))

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={many ? `${pictureIds.length} Bilder zeigen` : first ? `„${first.title}“ zeigen` : "Zeigen"}
      description={many ? "Die Bilder behalten ihre Reihenfolge." : undefined}
    >
      <div className="grid gap-2">
        <span className="font-semibold">Wann?</span>
        <Segmented
          label="Wann zeigen"
          value={when}
          onChange={setWhen}
          options={[
            { value: "naechstes", label: "Als Nächstes", note: nextNote(targets) },
            { value: "jetzt", label: "Jetzt", note: "so früh wie möglich" },
          ]}
        />
      </div>

      <div className="grid gap-2">
        <span className="font-semibold">Wo?</span>
        <Segmented
          label="Wo zeigen"
          value={where}
          onChange={setWhere}
          options={[
            { value: "rahmen", label: "Auf diesem Rahmen" },
            { value: "haus", label: "Im ganzen Haus" },
          ]}
        />
        {where === "rahmen" ? (
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-11 w-full bg-surface text-body" aria-label="Rahmen wählen">
              <SelectValue placeholder="Rahmen wählen" />
            </SelectTrigger>
            <SelectContent>
              {fitting.map((f) => (
                <SelectItem key={f.id} value={f.id} className="py-2 text-body">
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-small text-ink-soft">
            {many
              ? "Die Bilder kommen oben auf die Stapel. Die passenden Rahmen, die sich als Nächste melden, bekommen sie der Reihe nach, jeder eines."
              : "Das Bild kommt oben auf den Stapel. Der passende Rahmen, der sich als Nächster meldet, bekommt es."}
          </p>
        )}
      </div>

      {plan.data && warned && (
        <div className="grid gap-2 rounded-control border border-yellow bg-yellow-wash p-3">
          <strong className="flex items-center gap-2 text-yellow-ink">
            <TriangleAlert className="size-5" aria-hidden />
            {plan.data.warnings.length === 1 ? "Dieses Bild wäre doppelt zu sehen" : `${plan.data.warnings.length} Bilder wären doppelt zu sehen`}
          </strong>
          <ul className="m-0 grid list-none gap-2 p-0">
            {plan.data.warnings.map((w) => {
              const p = pictures.get(w.pictureId)
              return (
                <li key={w.pictureId} className="flex items-center gap-3 text-[15px]">
                  {p && <Thumb picture={p} byId={pictures} className="w-7" />}
                  <span>
                    {many && p ? `${p.title}. ` : ""}
                    {warningText(w, frames.get(w.frameId)?.name ?? "anderer Rahmen")}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-small">Von selbst kommt kein Bild auf einen zweiten Rahmen, solange es woanders hängt, vorgemerkt ist oder eben erst hing.</p>
        </div>
      )}

      {preview && preview.unplaced.length > 0 && (
        <p className="text-[15px] text-ink-soft">
          {preview.unplaced.length === 1 ? "Ein Bild passt" : `${preview.unplaced.length} Bilder passen`} im Format zu keinem dieser Rahmen und
          {preview.unplaced.length === 1 ? " bleibt" : " bleiben"} weg. Unter „Bearbeiten“ kannst du einen zweiten Zuschnitt anlegen.
        </p>
      )}

      <div className="grid gap-3 rounded-control bg-sunken p-3" aria-live="polite">
        <span className="text-small font-semibold text-ink-soft">{warned ? "Das passiert bei „Trotzdem zeigen“" : "Das passiert"}</span>
        {!preview && <span className="text-ink-soft">Einen Moment …</span>}
        {preview?.lines.map((line) => {
          const f = frames.get(line.frameId)
          if (!f) return null
          return (
            <div key={line.frameId} className="grid gap-1.5">
              <strong>{f.name}</strong>
              <p className="text-[15px]">{showSentence(line, f, when)}</p>
              {many && (
                <ol className="m-0 grid list-none gap-1.5 p-0">
                  {line.items.map((item, n) => {
                    const p = pictures.get(item.pictureId)
                    return (
                      <li key={item.pictureId} className="flex items-center gap-3">
                        <span className="w-4 shrink-0 text-right text-small text-ink-soft">{n + 1}</span>
                        {p && <Thumb picture={p} byId={pictures} className={p.orientation === "hoch" ? "w-7" : "w-11"} />}
                        <span className="grid min-w-0">
                          <span className="truncate text-[15px] font-semibold">{p?.title ?? "Bild"}</span>
                          <span className="text-small text-ink-soft">
                            {showItemWhen(line, n, item.at, when)}
                            {warnedIds.has(item.pictureId) && <span className="font-semibold text-yellow-ink">, wäre doppelt</span>}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          )
        })}
        {nothing && <p>Nichts: kein Rahmen passt zu dieser Auswahl.</p>}
        {preview && preview.lines.length > 0 && (
          <p className="text-small text-ink-soft">
            {many ? "Die Zeiten sind voraussichtlich: der Server sieht erst, was ankam, wenn sich ein Rahmen meldet. " : ""}
            Du kannst es zurücknehmen, bis es am Rahmen angekommen ist.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        {warned ? (
          <>
            <Button disabled={!preview || nothing || show.isPending} onClick={() => run(forced)}>
              Trotzdem zeigen
            </Button>
            {others > 0 && (
              <>
                <Button variant="outline" disabled={show.isPending} onClick={() => run(request)}>
                  {others === 1 ? "Nur das andere Bild zeigen" : `Nur die ${others} anderen zeigen`}
                </Button>
                <p className="text-small text-ink-soft">Lässt die Bilder weg, die doppelt wären. Die übrigen rücken in der Reihenfolge auf.</p>
              </>
            )}
          </>
        ) : (
          <Button disabled={!ready || !preview || nothing || show.isPending} onClick={() => run(request)}>
            {when === "jetzt" ? "Jetzt zeigen" : "Als Nächstes zeigen"}
          </Button>
        )}
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Abbrechen
        </Button>
      </div>
    </Sheet>
  )
}
