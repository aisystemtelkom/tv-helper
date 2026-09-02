"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/**
 * A tooltip is CHROME, and it has to keep declaring that it is.
 *
 * It used to paint the foreground ink as its ground and the ground as its text:
 * a near-white chip on a dark app. On a surface where the one thing allowed to be light is a document,
 * that reads as a scrap of paper, and the whole point of the graphite ground
 * is that a lit rectangle means evidence. So it takes `--popover`
 * (`--surface-rail`, the chrome tone) with a rule around it, and it never
 * lights up.
 *
 * THE DELAY IS THE REAL FIX. This provider shipped `delay = 0`, so a tooltip
 * opened on any hover, instantly. The operator's pointer crosses this screen
 * constantly while they are looking at a crop, and a popup that flashes open
 * over the evidence is worse than no tooltip at all. 600ms means the tooltip
 * answers a question the operator stopped to ask.
 *
 * A tooltip must also never cover the crop: place it with `side`, and do not
 * put anything in one that a decision depends on. Facts that a decision
 * depends on belong in the citation register, on screen, where they can be
 * read against the register above and below them.
 *
 * Text sits at 13px, the product's floor, not the 12px it was. Zoom and slide
 * are gone with the rest of the decoration; a fade is left, which says the
 * thing arrived without moving anything.
 */
function TooltipProvider({
  delay = 600,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-lg",
            "border border-border bg-popover px-2.5 py-1.5",
            "text-[0.8125rem] leading-[1.4] text-popover-foreground",
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-popover data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
