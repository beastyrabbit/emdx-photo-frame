import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "@/lib/theme"

const Toaster = (props: ToasterProps) => {
  const theme = useTheme()
  return (
    <Sonner
      theme={theme === "hell" ? "light" : theme === "dunkel" ? "dark" : "system"}
      position="top-center"
      // The button in a message ("Wiederherstellen") is a full touch target in the action colour.
      toastOptions={{ classNames: { actionButton: "!h-11 !rounded-control !bg-blue !px-3 !text-[15px] !font-semibold !text-on-blue" } }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line)",
          "--border-radius": "var(--r-control)",
          fontFamily: "var(--font-text)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
