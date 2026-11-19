import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"
import type * as React from "react"

// Sizes follow the 44 px touch target; "sm" is for rows that already have room around them.
// "icon-sm" draws a smaller icon but is still a full 44 px target.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-control border border-transparent font-semibold whitespace-nowrap no-underline transition-colors select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-blue text-on-blue hover:bg-blue/90",
        outline: "border-line bg-surface text-ink hover:bg-sunken",
        secondary: "bg-sunken text-ink hover:bg-line",
        ghost: "text-blue hover:bg-sunken",
        destructive: "border-line bg-surface text-red hover:bg-red-wash",
        link: "text-blue underline underline-offset-3",
      },
      size: {
        default: "h-11 gap-2 px-4 text-[15px]",
        sm: "h-9 gap-1.5 px-3 text-sm",
        lg: "h-12 gap-2 px-5 text-body",
        icon: "size-11",
        "icon-sm": "size-11 [&_svg:not([class*='size-'])]:size-[18px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
