import { cn } from "@/lib/utils"

/**
 * A placeholder for something that has not arrived yet.
 *
 * `--muted` used to be a near-white, so this pulsed an invisible bar on the
 * white pages and a wrong one on the graphite. It now maps to
 * `--surface-rail`, one step above the table, which is where a thing the app
 * is still fetching belongs.
 *
 * It keeps `animate-pulse` and carries NO reduced-motion guard of its own:
 * `globals.css` ends with one global `prefers-reduced-motion` rule that covers
 * every animation in the product, and a second copy here would be one more
 * place to forget.
 *
 * PREFER A COUNTED STRIP WHERE THE APP KNOWS HOW MANY THINGS ARE COMING. This
 * product's waits are countable, pages and slots, and `.lt-tick` fills one
 * tick per stored page, which is information. A shimmer is a claim that
 * something is happening; a count is a claim about how much is left.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-sm bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
