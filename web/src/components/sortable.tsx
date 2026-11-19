import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "cn"
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"

interface RowProps {
  id: string
  index: number
  count: number
  label: string
  onMove: (id: string, toIndex: number) => void
  children: React.ReactNode
}

function Row({ id, index, count, label, onMove, children }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-center gap-0.5 border-t border-line bg-paper py-2",
        isDragging && "relative z-10 rounded-control border border-blue bg-surface shadow-lg",
      )}
    >
      {/* Only the grip starts a drag, so the list still scrolls under a finger. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`${label} verschieben`}
        className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-ink-soft active:cursor-grabbing"
      >
        <GripVertical className="size-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="text-ink-soft"
          disabled={index === 0}
          aria-label={`${label} nach oben`}
          onClick={() => onMove(id, index - 1)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-ink-soft"
          disabled={index === count - 1}
          aria-label={`${label} nach unten`}
          onClick={() => onMove(id, index + 1)}
        >
          <ArrowDown />
        </Button>
      </div>
    </li>
  )
}

/**
 * A list whose rows can be reordered: drag the grip (hold it briefly on touch),
 * use the arrow buttons, or pick up the grip with Space and move with the arrow keys.
 */
export function SortableList<T extends { id: string; label: string }>({
  items,
  onMove,
  render,
}: {
  items: T[]
  onMove: (id: string, toIndex: number) => void
  render: (item: T, index: number) => React.ReactNode
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const to = items.findIndex((i) => i.id === over.id)
    if (to >= 0) onMove(String(active.id), to)
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `${labelOf(items, active.id)} aufgenommen.`,
          onDragOver: ({ active, over }) =>
            over ? `${labelOf(items, active.id)}, Position ${items.findIndex((i) => i.id === over.id) + 1} von ${items.length}.` : "",
          onDragEnd: ({ active, over }) => (over ? `${labelOf(items, active.id)} abgelegt auf Position ${items.findIndex((i) => i.id === over.id) + 1}.` : ""),
          onDragCancel: ({ active }) => `Verschieben von ${labelOf(items, active.id)} abgebrochen.`,
        },
        screenReaderInstructions: {
          draggable: "Leertaste nimmt das Bild auf, Pfeiltasten verschieben es, Leertaste legt es ab, Escape bricht ab.",
        },
      }}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ol className="m-0 list-none p-0">
          {items.map((item, index) => (
            <Row key={item.id} id={item.id} index={index} count={items.length} label={item.label} onMove={onMove}>
              {render(item, index)}
            </Row>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

const labelOf = (items: { id: string; label: string }[], id: string | number) => items.find((i) => i.id === id)?.label ?? "Bild"
