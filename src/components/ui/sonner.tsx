import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast, useSonner } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const DEFAULT_MS = 4000;

/**
 * Messages always go away. Sonner pauses a message's timer while a finger or mouse is on it, and on an
 * iPhone a tap counts as "still on it" until you tap somewhere else, so a tapped message could stay forever
 * (seen after a completed trade). Each message is closed a few seconds after its time is up, whatever happened.
 */
function ToastWatchdog() {
  const { toasts } = useSonner();
  const timers = useRef(new Map<string | number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    for (const [id, timer] of timers.current) if (!live.has(id)) { clearTimeout(timer); timers.current.delete(id); }
    for (const t of toasts) {
      if (timers.current.has(t.id) || t.type === "loading" || t.promise || t.duration === Infinity) continue;
      timers.current.set(t.id, setTimeout(() => { toast.dismiss(t.id); timers.current.delete(t.id); }, (t.duration ?? DEFAULT_MS) + 2500));
    }
  }, [toasts]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);
  return null;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  // On phones the bottom of the screen holds the tabs and the trade button, so messages appear at the top.
  const isMobile = useIsMobile();

  return (
    <>
    <ToastWatchdog />
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position={isMobile ? "top-center" : undefined}
      mobileOffset={{ top: "64px" }}
      duration={DEFAULT_MS}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
    </>
  );
};

export { Toaster, toast };
