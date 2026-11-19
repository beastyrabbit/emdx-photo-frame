import { ChevronRight, CircleHelp, History, KeyRound, Palette, PartyPopper, Plus } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"
import { api } from "@/api"
import { useAct, useKeys, useOverview, useSettings } from "@/api/hooks"
import { PageHead, Section, SettingRow } from "@/components/bits"
import { StateMark } from "@/components/marks"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { cadenceText } from "@/lib/cadence"
import { setTheme, type Theme, useTheme } from "@/lib/theme"

export function NavRow({
  to,
  icon: Icon,
  title,
  text,
}: {
  to: string
  icon?: React.ComponentType<{ className?: string }>
  title: React.ReactNode
  text?: React.ReactNode
}) {
  return (
    <li className="border-t border-line">
      <Link to={to} className="flex min-h-14 items-center gap-3 py-2 text-ink no-underline">
        {Icon && <Icon className="size-5 shrink-0 text-ink-soft" />}
        <span className="grid min-w-0 flex-1">
          <span className="font-semibold">{title}</span>
          {text && <span className="text-[15px] text-ink-soft">{text}</span>}
        </span>
        <ChevronRight className="size-5 shrink-0 text-ink-soft" aria-hidden />
      </Link>
    </li>
  )
}

export function SettingsScreen() {
  const { data: overview } = useOverview()
  const settings = useSettings()
  const keys = useKeys()
  const theme = useTheme()
  const update = useAct(api.updateSettings)
  const s = settings.data
  const broken = keys.data?.filter((k) => !k.later && k.status !== "funktioniert") ?? []

  return (
    <div className="grid gap-8">
      <PageHead title="Einstellungen" />

      <ul className="m-0 list-none p-0 min-[900px]:hidden [&>li:last-child]:border-b">
        <NavRow to="/events" icon={PartyPopper} title="Events" text="Geburtstage und Feste" />
        {s?.extras.art && <NavRow to="/kunst" icon={Palette} title="Kunst" text="Gemeinfreie Kunstwerke suchen und in den Eingang holen" />}
        <NavRow to="/verlauf" icon={History} title="Verlauf" />
        <NavRow to="/hilfe" icon={CircleHelp} title="So funktioniert's" />
      </ul>

      <Section
        title="Rahmen"
        aside={
          <Button asChild variant="outline" size="sm">
            <Link to="/einstellungen/rahmen-neu">
              <Plus />
              Rahmen hinzufügen
            </Link>
          </Button>
        }
      >
        {!overview ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <ul className="m-0 list-none p-0 [&>li:last-child]:border-b">
            {overview.frames.map((f) => (
              <NavRow
                key={f.id}
                to={`/einstellungen/rahmen/${f.id}`}
                title={
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {f.name}
                    <span className="text-small font-normal text-ink-soft">
                      {f.device}, {f.ip}
                    </span>
                  </span>
                }
                text={`${overview.groups.find((g) => g.id === f.groupId)?.name}. ${f.power === "dauerstrom" ? "Dauerstrom" : "Akku"}, ${cadenceText(f.cadence.value)}${f.cadence.confirmedAt ? "" : " (wartet auf Rahmen)"}`}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Bilder">
        {!s ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid gap-5">
            <SettingRow
              title="Neue Bilder ohne Hinweis gleich übernehmen"
              text="Bilder ohne Hinweis kommen direkt in den Stapel. Zu kleine, unscharfe und wohl doppelte bleiben im Eingang, bis du entscheidest."
            >
              <Switch
                checked={s.autoAccept}
                onCheckedChange={(v) => update.mutate({ autoAccept: v })}
                aria-label="Neue Bilder ohne Hinweis gleich übernehmen"
              />
            </SettingRow>
          </div>
        )}
      </Section>

      <Section title="Zugänge">
        <ul className="m-0 list-none p-0 [&>li:last-child]:border-b">
          <NavRow
            to="/einstellungen/zugaenge"
            icon={KeyRound}
            title="Schlüssel für Immich und andere Dienste"
            text={
              !keys.data ? (
                "Lädt …"
              ) : broken.length ? (
                <StateMark level="bad" className="text-[15px] font-normal">
                  {broken.map((k) => k.name).join(", ")}: {broken[0].status === "fehlt" ? "Schlüssel fehlt" : "funktioniert nicht mehr"}
                </StateMark>
              ) : (
                <StateMark level="ok" className="text-[15px] font-normal text-ink-soft">
                  Immich funktioniert
                </StateMark>
              )
            }
          />
        </ul>
        <p className="text-small text-ink-soft">Diese Seite hat kein Passwort. Jeder im Heimnetz kann sie benutzen.</p>
      </Section>

      <Section title="Darstellung">
        <Segmented<Theme>
          label="Darstellung"
          value={theme}
          onChange={setTheme}
          className="min-[560px]:w-fit min-[560px]:min-w-[340px]"
          options={[
            { value: "system", label: "Wie das Gerät" },
            { value: "hell", label: "Hell" },
            { value: "dunkel", label: "Dunkel" },
          ]}
        />
      </Section>

      <Section title="Weitere Bildquellen">
        <p className="text-[15px] text-ink-soft">Zwei Extras neben Hochladen und Immich. Für den Alltag sind sie nicht nötig.</p>
        {s && (
          <div className="grid gap-5">
            <SettingRow
              title="Bilder aus einem Text erzeugen"
              text="Du beschreibst ein Bild, ein KI-Dienst zeichnet es. Braucht einen eigenen Schlüssel und kostet pro Bild ein paar Cent."
            >
              <Switch
                checked={s.extras.generate}
                onCheckedChange={(v) => update.mutate({ extras: { ...s.extras, generate: v } })}
                aria-label="Bilder aus einem Text erzeugen"
              />
            </SettingRow>
            <SettingRow
              title="Kunstkatalog"
              text={
                s.extras.art ? (
                  <>
                    Eingeschaltet: <Link to="/kunst">Kunst</Link> steht in der Navigation, und jede <Link to="/gruppen">Gruppe</Link> kann Kunstwerke
                    untermischen.
                  </>
                ) : (
                  "Gemeinfreie Kunstwerke aus Museen suchen und in den Eingang holen. Eingeschaltet erscheint „Kunst“ in der Navigation."
                )
              }
            >
              <Switch
                checked={s.extras.art}
                onCheckedChange={(v) =>
                  update.mutate(
                    { extras: { ...s.extras, art: v } },
                    {
                      onSuccess: () =>
                        v ? toast.success("Kunstkatalog eingeschaltet: „Kunst“ steht jetzt in der Navigation") : toast("Kunstkatalog ausgeschaltet"),
                    },
                  )
                }
                aria-label="Kunstkatalog"
              />
            </SettingRow>
            <p className="text-[15px]">
              Die bisherige Statusseite bleibt als Notlösung erreichbar: <a href="/alt">Bisherige Seite öffnen</a>
            </p>
          </div>
        )}
      </Section>
    </div>
  )
}
