import { cn } from "cn"
import { useSearchParams } from "react-router"
import { useHistory, useOverview } from "@/api/hooks"
import type { HistoryEntry } from "@/api/types"
import { Chip, ChipRow, Empty, PageHead } from "@/components/bits"
import { HistoryLine } from "@/components/history-line"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtDay, fmtTime } from "@/lib/format"

const KINDS: { id: HistoryEntry["kind"]; label: string }[] = [
  { id: "wechsel", label: "Wechsel" },
  { id: "uebertragung", label: "Übertragungen" },
  { id: "aenderung", label: "Änderungen" },
  { id: "problem", label: "Probleme" },
  { id: "eingang", label: "Eingang" },
  { id: "event", label: "Events" },
]

export function HistoryScreen() {
  const [params, setParams] = useSearchParams()
  const frameId = params.get("rahmen")
  const kind = params.get("art")
  const { data } = useHistory()
  const { data: overview } = useOverview()
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  // "Alle Schritte dieser Änderung": setting, transfer and confirmation of one change, and nothing else.
  const changeId = params.get("aenderung")
  const list = (data ?? []).filter((h) => (changeId ? h.change?.id === changeId : (!frameId || h.frameId === frameId) && (!kind || h.kind === kind)))
  const days = new Map<string, HistoryEntry[]>()
  for (const h of list) {
    const d = fmtDay(h.at)
    days.set(d, [...(days.get(d) ?? []), h])
  }
  const name = (id: string | null) => overview?.frames.find((f) => f.id === id)?.name

  return (
    <div className="grid gap-5">
      <PageHead title="Verlauf" lead="Was du geändert hast, was an die Rahmen ging und was sie zurückgemeldet haben." />
      {changeId && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-control border border-blue bg-surface px-4 py-2">
          <p className="text-[15px]">
            <strong>Die Schritte einer Änderung</strong>
            {list[0] ? `: ${name(list[0].frameId) ? `${name(list[0].frameId)}, ` : ""}${list[list.length - 1].text}` : ""}. Der neueste steht oben.
          </p>
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => set("aenderung", null)}>
            Ganzen Verlauf zeigen
          </Button>
        </div>
      )}
      <div className={cn("grid gap-2", changeId && "hidden")}>
        <ChipRow label="Rahmen">
          <Chip pressed={!frameId} onClick={() => set("rahmen", null)}>
            Alle Rahmen
          </Chip>
          {overview?.frames.map((f) => (
            <Chip key={f.id} pressed={frameId === f.id} onClick={() => set("rahmen", frameId === f.id ? null : f.id)}>
              {f.name}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Art">
          {KINDS.map((k) => (
            <Chip key={k.id} pressed={kind === k.id} onClick={() => set("art", kind === k.id ? null : k.id)}>
              {k.label}
            </Chip>
          ))}
        </ChipRow>
      </div>
      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : list.length === 0 ? (
        <Empty title="Dazu gibt es keinen Eintrag" />
      ) : (
        [...days].map(([day, entries]) => (
          <section key={day} className="grid gap-1">
            <h2 className="sticky top-0 z-10 bg-paper py-2 text-lead first-letter:uppercase">{day}</h2>
            <ol className="m-0 list-none p-0">
              {entries.map((h) => (
                <li key={h.id} className="grid grid-cols-[3.25rem_auto_minmax(0,1fr)] items-baseline gap-x-2 border-t border-line py-2.5 text-[15px]">
                  <span className="text-ink-soft">{fmtTime(h.at)}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 translate-y-[-2px]",
                      !h.ok
                        ? "rotate-45 rounded-[1px] bg-red"
                        : h.kind === "aenderung"
                          ? "rounded-full border-2 border-blue"
                          : h.kind === "wechsel" || h.kind === "uebertragung"
                            ? "rounded-full bg-green"
                            : "rounded-full bg-ink-soft",
                    )}
                  />
                  <HistoryLine entry={h} frameName={name(h.frameId)} followed={!!changeId} />
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  )
}
