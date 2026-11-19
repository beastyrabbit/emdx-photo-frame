import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { useWide } from "@/lib/use-media"

/** A bottom sheet on the phone, a centred dialog on wide screens. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
}) {
  const wide = useWide()
  if (wide) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto rounded-sheet bg-surface p-6 text-body sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="pr-8 text-title font-semibold">{title}</DialogTitle>
            {description ? (
              <DialogDescription className="text-body text-ink-soft">{description}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">{title}</DialogDescription>
            )}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]! rounded-t-sheet! bg-surface text-body">
        <div className="grid gap-4 overflow-y-auto px-4 pt-2 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <DrawerHeader className="p-0 text-left!">
            <DrawerTitle className="text-title font-semibold">{title}</DrawerTitle>
            {description ? (
              <DrawerDescription className="text-body text-ink-soft">{description}</DrawerDescription>
            ) : (
              <DrawerDescription className="sr-only">{title}</DrawerDescription>
            )}
          </DrawerHeader>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
