import { cn } from "cn"
import { RadioGroup } from "radix-ui"

/** One choice out of a few, all visible at once. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: React.ReactNode; note?: string }[]
  label: string
  className?: string
}) {
  const withNotes = options.some((o) => o.note)
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-label={label}
      className={cn("grid auto-cols-fr grid-flow-col gap-1 rounded-control bg-sunken p-[3px]", className)}
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            "grid min-h-[38px] place-content-center place-items-center rounded-[8px] px-3 text-center text-[15px] text-ink-soft transition-colors data-[state=checked]:bg-surface data-[state=checked]:font-semibold data-[state=checked]:text-ink data-[state=checked]:shadow-[0_1px_2px_rgb(0_0_0/0.18)]",
            withNotes && "py-2",
          )}
        >
          <span>{o.label}</span>
          {o.note && <span className="text-small font-normal text-ink-soft">{o.note}</span>}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
