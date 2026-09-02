"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

/**
 * A disclosure: behaviour only, no material of its own.
 *
 * It carries no palette, so it needed no un-darkening. What it does carry is a
 * decision, and the decision is that IT DOES NOT ANIMATE ITS HEIGHT.
 * `globals.css` defines `collapsible-down` and `collapsible-up` keyframes from
 * the shadcn scaffold and nothing wires them, on purpose: the product has one
 * orchestrated moment of motion, the paraf drawing under the operator's own
 * click, and a panel that grows is decoration next to it. A disclosure that
 * simply appears is also the honest picture of what happened, since the
 * content was already there.
 *
 * If a screen ever does need the height to resolve rather than snap, the wiring
 * is an arbitrary `animate-[...]` utility naming the `collapsible-down` and
 * `collapsible-up` keyframes on the panel's open and closed states, plus a
 * clipped overflow so the height has something to clip. The global
 * `prefers-reduced-motion` rule at the end of `globals.css` covers it, so it
 * still needs no guard here. Written out in full it would be scanned out of
 * this comment and emitted as real CSS, which is why it is described instead.
 *
 * The trigger stays unstyled so a caller can hand it a `Button` through
 * `render`, or a bare summary line, without fighting a default.
 */
function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
