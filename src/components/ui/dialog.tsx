"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Tutup } from "@/components/operator/icons"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * A modal.
 *
 * THE SCRIM DOES NOT BLUR. It was black at 10 percent with a backdrop filter
 * behind it, which is two mistakes on this particular product. A 10 percent
 * veil does not separate anything from a busy
 * graphite proof sheet, so the operator reads the dialog against live
 * evidence; and blurring the backdrop blurs THE CROP THEY ARE STILL DECIDING
 * ON, which is the one pixel-accurate thing on the screen.
 *
 * IT IS `.lt-veil`, AND THAT IS NOW ACTUALLY ONE RECIPE WITH `.lt-scrim`.
 * This comment used to say it already was: "the sunk tone at 75%, the same
 * recipe `.lt-scrim` uses in the zone editor". It was a different token.
 * `.lt-scrim` dims with `--mat`; this dimmed with `--surface-sunk`, which is
 * LIGHTER than the mat, so veiling a crop mounted on its near-black surround
 * LIFTED that surround by 1.07:1 instead of putting it out of reach. Both now
 * dim with `--mat`, at the two strengths their two jobs need (78% for the zone
 * editor, where the operator still has to read the surrounding page; 86% here,
 * where they do not). Measured: a white scan behind a dialog drops 14.33:1.
 * The value lives in `globals.css` as `--veil`.
 *
 * THE PANEL IS `.lt-panel`, not a card and not a popover. `--popover` maps to
 * `--surface-rail`, which is chrome, and chrome must never hold a fact you
 * read for meaning; a dialog holds nothing else. `.lt-panel` is the LIFTED
 * block: it rebinds `--surface-raised` to `--surface-lift` and takes the
 * radius scale's top step, 28px, which is the one thing in the product large
 * enough to wear it. Taking the class rather than re-deriving it keeps one
 * definition of the material. (This paragraph used to say `--surface-raised`
 * at 6px; both numbers were left behind by the restyle, and a dialog that is
 * the same fill as the block behind it is exactly what the lifted value
 * exists to prevent -- it reads 1.40:1 against a veiled scan where a
 * slab-coloured panel measured 1.15:1.) No shadow: `.lt-paper` owns the only
 * shadow in the stylesheet, and a dialog is not a document.
 *
 * THE CLOSE AFFORDANCE PINS ITS OWN RADIUS. `Button` is still written against
 * the pre-restyle scale -- its doc comment says `--radius` is 0.25rem and
 * `rounded-lg` is 4px -- and `--radius` is now 0.875rem, so `rounded-lg` on a
 * 28px icon button is a 14px radius on a 28px box, which is a circle. The
 * product has no circular controls. `rounded-[8px]` is the figure step and
 * `cn`'s tailwind-merge lets it beat the variant's own class. When `Button` is
 * brought onto this system the override comes back out.
 *
 * THE DEFAULT WIDTH IS NOT A CROP'S WIDTH. It was 384px, which
 * cannot carry a page of an Indonesian contract at a size anyone can rule on.
 * 576px is a confirmation, a short form, a question. A surface that has to
 * show evidence sets its own width, and the zone editor is not a Dialog at
 * all: an operator draws a rectangle on a page while reading the register
 * beside it, and neither survives being trapped in a modal.
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
          "text-[0.9375rem] text-foreground duration-100",
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
                className="absolute top-2 right-2 rounded-[8px]"
                size="icon-sm"
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

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
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
        "-mx-4 -mb-4 mt-1 flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end",
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
        "lt-lede [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
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
