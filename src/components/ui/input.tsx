import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * A field.
 *
 * THE MATERIAL IS `.lt-well`: recessed into the table, because an input holds
 * something the app READ back rather than something it is telling you. Same
 * sunk ground, same 1px rule, same 4px radius as the operator screens' own
 * `.lt-input`, and the same voice: THE VALUE IS MONO (`.lt-figure`, tabular
 * figures) because a value in this product is an email address, a quote
 * number or a page, and two of them will be read against each other down a
 * column; the PLACEHOLDER goes back to the sans, because a placeholder is the
 * app talking.
 *
 * ONE DELIBERATE DIFFERENCE FROM `.lt-input`, which sets 13px. That is the
 * floor, and it is right for a cell in a dense register beside a crop. This
 * primitive is the field on a plain page, the sign-in form and the allowlist,
 * where the value IS the object on the screen and the typo it hides grants
 * access to the wrong address. It takes the body size, 15px. It used to be set
 * at 16px stepping down to 14px at the `md` breakpoint, which meant 14px on
 * every monitor this product is actually used on: an iOS zoom workaround,
 * shipped in an internal desktop tool.
 *
 * Focus is the global ink outline. The `outline: none` utility and the focus
 * ring that stood in for it cancelled it, because utilities beat `@layer base`,
 * and a field is exactly where a keyboard operator most needs to be sure where
 * they are. The explicit radius matters for the same reason as on the
 * button: the base focus rule also sets `border-radius: 2px`.
 *
 * The background drawn from `--input` at 30 percent, and its `dark:` twin, are
 * gone with the rest of the dark branches, and they were worse than dead:
 * `--input` now maps to `--line`, the rule colour, so a ground taken from it
 * would paint the field the colour of its own border.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "lt-figure h-8 w-full min-w-0 rounded-lg border border-input bg-surface-sunk px-2.5 py-1",
        "text-[0.9375rem] text-foreground",
        "placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-3",
        "transition-[border-color] duration-[90ms] hover:border-line-strong",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-sans file:text-[0.8125rem] file:font-semibold file:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-[0.42]",
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
