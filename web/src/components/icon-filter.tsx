import { cn } from "cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export interface IconOption {
  value: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

/**
 * A group of filters as signs: at most one is on, pressing it again takes it off.
 * The one that is on spells out its name, so the row always says what it filters by;
 * the others name themselves on hover and to screen readers.
 */
export function IconFilter({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: IconOption[]
  value: string | null
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <fieldset aria-label={label} className={cn("m-0 flex min-w-0 items-center gap-0.5 rounded-control border border-line bg-surface p-[3px]", className)}>
      {options.map(({ value: v, label: name, icon: Icon }) => {
        const on = value === v
        return (
          <Tooltip key={v}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={on}
                aria-label={name}
                onClick={() => onChange(v)}
                className={cn(
                  "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[7px] px-2 text-[15px] whitespace-nowrap transition-colors",
                  on ? "bg-ink px-3 font-semibold text-paper" : "text-ink-soft hover:bg-sunken hover:text-ink",
                )}
              >
                <Icon className="size-[18px] shrink-0" aria-hidden />
                {on && <span aria-hidden>{name}</span>}
              </button>
            </TooltipTrigger>
            {!on && (
              <TooltipContent className="text-small">
                {label}: {name}
              </TooltipContent>
            )}
          </Tooltip>
        )
      })}
    </fieldset>
  )
}
