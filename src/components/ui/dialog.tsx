"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Tutup } from "@/components/operator/icons"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * A modal.
 *
 * THE VEIL DOES NOT BLUR, AND IT IS NOW MEASURED RATHER THAN ASSERTED. It was
 * black at 10 percent with a backdrop filter behind it, which is two mistakes
 * on this particular product. A 10 percent veil does not separate anything
 * from a busy proof sheet, so the operator reads the dialog against live
 * evidence; and blurring the backdrop blurs THE CROP THEY ARE STILL DECIDING
 * ON, which is the one pixel-accurate thing on the screen.
 *
 * IT IS `.lt-veil`, AND THAT IS NOW ACTUALLY ONE RECIPE WITH `.lt-scrim`.
 * This comment used to say it already was: "the sunk tone at 75%, the same
 * recipe `.lt-scrim` uses in the zone editor". It was a different token.
 * `.lt-scrim` dims with `--mat`; this dimmed with `--surface-sunk`, which is
 * LIGHTER than the mat, so veiling a crop mounted on its near-black surround
 * LIFTED that surround instead of putting it out of reach. Both now dim with
 * `--mat`, at the two strengths their two jobs need: 78% for the zone editor,
 * where the operator still has to read the surrounding page, and 86% here,
 * where they do not. The value lives in `globals.css` as `--veil`.
 *
 * RE-MEASURED AGAINST THE THING THE VEIL EXISTS FOR, which is a review sheet
 * carrying a white A4 scan and a near-black evidence mat in the same frame. A
 * veil that lightens the mat while barely dimming the scan is not a veil, and
 * that is exactly what the old recipe did. Composited by hand out of the
 * shipped token values:
 *
 *   a white scan          drops 14.72:1 (the `--paper` token, 14.33:1)
 *   the evidence mat      1.00:1, unmoved, by construction: `--mat` over
 *                         `--mat` is `--mat`
 *   a slab                1.53:1, and the bare ground 1.33:1
 *   `.lt-panel` in front  1.40:1 against the veiled scan
 *
 * The old `--surface-sunk` at 75% for comparison: the scan dropped only
 * 8.40:1, the mat was LIFTED 1.07:1 the wrong way, and the panel read 1.24:1
 * against the veiled scan, which is close enough to land on either side of it
 * depending on what happened to be behind. The two columns are the same
 * measurement taken on two whites, so they reconcile with `globals.css` rather
 * than competing with it: pure white gives 14.72 and 8.40, the `--paper` token
 * gives the 14.33 and 8.25 that file quotes, and 1.24 and 1.40 are both on
 * `--paper`.
 *
 * THE CLASS IS WRITTEN HERE AS WELL AS THE SLOT, ON PURPOSE. The rule in
 * `globals.css` is unlayered and keyed on both `.lt-veil` and
 * `[data-slot="dialog-overlay"]`, so it beats any Tailwind utility whichever
 * of the two lands. Keeping the class means the backdrop still says in this
 * file what material it is.
 *
 * THE PANEL IS `.lt-panel`, not a card and not a popover. `--popover` maps to
 * `--surface-rail`, which is chrome, and chrome must never hold a fact you
 * read for meaning; a dialog holds nothing else. `.lt-panel` is the LIFTED
 * block: it rebinds `--surface-raised` to `--surface-lift` and takes the
 * radius scale's top step, 28px, which is the one thing in the product large
 * enough to wear it. Taking the class rather than re-deriving it keeps one
 * definition of the material.
 *
 * IT IS SOLID AND NOT GLASS, WHICH IS THE SEAM RULE RATHER THAN AN OVERSIGHT.
 * `globals.css` opens by listing a dialog among the things that stay still and
 * therefore take glass, and its own `.lt-panel` rule then says a dialog is a
 * lifted SOLID block, with the veil measurements above depending on the panel
 * being opaque. The specific rule and the numbers win over the list: frosting
 * a panel that stands on an 86% veil samples the veil, not the room, so the
 * blur costs a frame budget and buys nothing you can see.
 *
 * THE DEFAULT WIDTH IS NOT A CROP'S WIDTH. It was 384px, which cannot carry a
 * page of an Indonesian contract at a size anyone can rule on. 576px is a
 * confirmation, a short form, a question. A surface that has to show evidence
 * sets its own width, and the zone editor is not a Dialog at all: an operator
 * draws a rectangle on a page while reading the register beside it, and
 * neither survives being trapped in a modal.
 *
 * THE CLOSE AFFORDANCE NO LONGER PINS ITS OWN RADIUS, AND THAT IS THE WHOLE
 * POINT OF THE BUTTON REWRITE. This file used to carry `rounded-[8px]` on it
 * with a note saying the override comes back out when `Button` is brought onto
 * this system. `Button` renders `.lt-btn` now, so it has: the control radius,
 * the 44px floor and the flat control's own boundary all arrive from the class
 * that every other control in the product uses.
 *
 * Zoom is gone, the fade is kept, and there is no reduced-motion guard here
 * because `globals.css` ends with one that covers the whole product. Focus is
 * the global ink outline: no `outline: none` is reinstated on the popup, so a
 * keyboard operator can see that the dialog took focus when it opened.
 */
function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "lt-veil fixed inset-0 isolate z-50 duration-100",
        "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = "Tutup",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** Every string a person can read is a prop, so a caller can say it in the
      words its own screen uses. The default is the one the glossary fixes. */
  closeLabel?: string
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "lt-panel fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] sm:max-w-xl",
          "-translate-x-1/2 -translate-y-1/2 gap-4 p-4",
          // `text-ink` rather than `text-foreground`: the two resolve to the
          // same value, and naming the product's own token is what stops the
          // next reader believing there are two palettes in here.
          "text-[0.9375rem] text-ink duration-100",
          "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2"
              />
            }
          >
            <Tutup size={16} />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

/**
 * THE HEADER RESERVES THE CLOSE BUTTON'S COLUMN, AND IT RESERVES IT WHETHER OR
 * NOT THE BUTTON IS THERE. The close is absolutely positioned 8px in from the
 * top right and is a 44px control, so it occupies the first 52px of the
 * panel's right edge; the panel's own padding accounts for 16 of those, and
 * `pr-12` covers the rest with 12px to spare. Without it a title long enough
 * to wrap runs underneath the close, which is a heading a person can read and
 * a control they cannot reach in the same 44 pixels.
 *
 * Unconditional, because `outstanding-panel.tsx` passes
 * `showCloseButton={!busy}` and flips it on every ingest: a header that
 * reserved the gutter only when the button existed would reflow the title and
 * the lede under the operator every time a document started and finished being
 * read. The lede is capped at 66ch by `.lt-lede` and rarely reaches the
 * gutter anyway, so the cost of holding it is nothing.
 */
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 pr-12", className)}
      {...props}
    />
  )
}

/**
 * The footer is separated by a RULE, not by a bar of tint. A block in this
 * product is the space between two rules, and a tinted strip along the bottom
 * of a panel is the card habit coming back in through a side door.
 */
function DialogFooter({
  className,
  showCloseButton = false,
  closeLabel = "Tutup",
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
  closeLabel?: string
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 mt-1 flex flex-col-reverse gap-2 border-t border-line p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          {closeLabel}
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

/**
 * `.lt-title`, the same object as a screen or section title: sentence case,
 * real weight, and no tracked-out label floating above it to give it rank.
 * The title is the label.
 */
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("lt-title", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "lt-lede [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-ink",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
