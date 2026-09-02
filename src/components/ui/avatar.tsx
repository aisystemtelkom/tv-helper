"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "@/lib/utils"

/**
 * An account, as a small ruled box with initials in it.
 *
 * THE FALLBACK IS THE PATH THIS APP USES, and `AvatarImage` below is a trap
 * kept in the open rather than removed, because the two halves of the trap
 * already exist: `AuthorizedUser` carries an `image` from the Google session,
 * and connecting it to `AvatarImage` looks like an obvious small improvement.
 * It is not. See the comment on `AvatarImage`.
 *
 * The box is squared at `--radius`, like every other container in the product.
 * Nothing else here is a circle, and a circle would be a material this system
 * does not otherwise own. It is the same shape and near enough the same size
 * as `.lt-mark-box`, which is the right family: a small ruled box with one
 * mark in it, which is what an initial is.
 *
 * The border used to be a pseudo-element with a darken blend mode and a
 * `dark:` twin flipping it to lighten. Nothing applies a `.dark` class, so
 * on the only ground this app has, the blend picked the darker of the rule and
 * the ground and the border disappeared. It is a plain 1px rule now, with the
 * box clipping whatever sits inside it.
 */
function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted select-none data-[size=lg]:size-10 data-[size=sm]:size-6",
        className
      )}
      {...props}
    />
  )
}

/**
 * KEPT, AND NOT FOR THIS APP TO USE.
 *
 * Pointing this at the `image` URL on a Google session fetches from
 * lh3.googleusercontent.com, and this project's standing proof is that
 * `performance.getEntriesByType("resource")` shows no host but this one on
 * every page. That proof is the client's third-party minimisation constraint
 * made checkable in one line, and a profile photo would break it silently:
 * nothing would look wrong, the picture would simply arrive from somewhere
 * else. It is the same rule that keeps the fonts on `next/font`, the pdf.js
 * worker bundled and the tesseract assets vendored.
 *
 * Use `AvatarFallback` with locally rendered initials. This part stays only
 * because a future surface may have a genuinely same-origin image, and it
 * should not have to be rewritten from memory when it does.
 */
function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full object-cover", className)}
      {...props}
    />
  )
}

/**
 * Initials, drawn here, from a name this app already holds.
 *
 * Sans, not mono: the mono face is the document's own voice, and the test for
 * it is whether two instances of the string would ever be read against each
 * other down a column. One person's initials in an application strip never
 * are.
 */
function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center text-[0.8125rem] font-semibold text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-[0.8125rem] font-semibold text-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
}
