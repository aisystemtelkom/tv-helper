import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The generic button, and it is now THE SAME OBJECT AS `.lt-btn` rather than a
 * second button drawn beside it.
 *
 * It renders the class instead of re-deriving it out of utilities. That is the
 * whole change and it is worth being blunt about why: a control assembled from
 * `border`, `rounded-lg`, `h-8` and a hover colour is a SECOND definition of
 * the product's only control, and the two drift the moment either is touched.
 * `.lt-btn` already owns the face, the ink ladder on that face, the solid lip,
 * the press that lands the face on its own lip, the disabled state and the
 * flat variant, each with its measurements written down next to it in
 * `globals.css`. There is nothing left here to invent.
 *
 * WHAT THE COMMENT THAT USED TO BE HERE CLAIMED, AND WHY IT IS RECORDED RATHER
 * THAN QUIETLY DELETED. It said `--radius` is 0.25rem and therefore
 * `rounded-lg` is 4px; that the button is 13px at weight 600 and 32px tall;
 * that it is bordered with a 1px rule; and that `variant="outline"` IS
 * `.lt-btn`. Every one of those was true of a stamped-plate system that no
 * longer exists. `--radius` is 0.875rem, `.lt-btn` is 14px at weight 700 with
 * a 44px floor, it sets `border: 0`, and it is a pressed key with a solid lip,
 * which no outline variant has ever been. The file read as carefully
 * maintained while describing a product nobody could see, which is this
 * project's own failure class arriving in a doc comment instead of in a crop.
 *
 * THE TONE IS AN ATTRIBUTE, NOT A CLASS, BECAUSE THAT IS WHERE `.lt-btn` LOOKS
 * FOR IT: its faces are `[data-tone="primary"]`, `[data-tone="reject"]` and
 * `[data-flat="true"]`, which is the same shape `chrome.tsx`'s own `Btn` fills
 * in. So `buttonVariants` returns the SHAPE of a control and never its tone,
 * and `Button` is what puts the attribute on the element. A caller that reaches
 * for `buttonVariants` on a raw element therefore gets a neutral key and has to
 * carry `data-tone` itself; nothing in this app does that today, and the export
 * survives only because it is part of this primitive's public surface.
 *
 * Props spread LAST, so a caller can still hand through `data-on="true"`, which
 * is this system's word for "this is the open or current one" (the phase step
 * you are standing on, the run that is open). It is petrol rather than amber
 * on purpose: standing somewhere is not a decision owed.
 *
 * THE VARIANTS, EACH AGAINST THE FACE IT ACTUALLY GETS:
 *
 *   default      the key in petrol, the one action a screen wants. Petrol is
 *                identity, so it can never be read as a decision owed. Its
 *                dark ink measures 9.26:1 on the face.
 *   secondary    the neutral key: a light slate face with dark ink (6.36:1)
 *                and a solid darker lip.
 *   destructive  the key wearing the correction pen. The LABEL goes red and
 *                the face does not, because `--gap` is a rule, a stroke or a
 *                text colour and never a fill (4.75:1 on the bench, 4.91:1 on
 *                a sheet, where the face inverts). `globals.css` asks for a
 *                red LIP as well and it does not currently arrive; the
 *                `--plate` note below is why, and it is not this file's to
 *                fix.
 *   outline      the flat control: a ruled row with a real `--line-control`
 *                boundary and a 2px inset line that goes under the finger.
 *   ghost        THE SAME OBJECT AS `outline`, and it has to be. A control
 *                with no resting boundary is exactly the defect
 *                `--line-control` was introduced to close (WCAG 1.4.11 asks
 *                3:1 of a control against what is next to it, and the review
 *                sheet was two dozen of them deep with none). There is no
 *                fainter face to hand a ghost, so it gets this one rather
 *                than a hairline nobody can see.
 *   link         not a control face at all: ink, an underline on hover, no
 *                key, no lip, no floor.
 *
 * `aria-invalid` MOVES THE TWO BOUNDARY TOKENS, AND ONLY ONE OF THEM REACHES
 * PAINT TODAY. It used to be `aria-invalid:border-destructive`, and `.lt-btn`
 * sets `border: 0`: a border-colour on a zero-width border paints nothing at
 * all, which is the same silent no-op `globals.css` records for the locked
 * phase step's inline dashed border. A refusal is carried instead by the two
 * tokens the two families already read for their own boundary, so no new
 * geometry appears: `--line-control` (the flat control's rule and its inset
 * bottom line) and `--lip` (the key's 1.5px ring and its shelf). Both go to
 * `--gap`.
 *
 * `--line-control` IS READ ON THE ELEMENT, SO IT PAINTS. `.lt-btn[data-flat]`
 * writes `border: 1px solid var(--line-control)` and its inset bottom line in
 * its own rule, so the substitution happens on the button and the utility
 * beats it: 5.99:1 on a slab, 4.93:1 on a lifted plate, 5.43:1 on the opaque
 * rail, and 7.60:1 on a sheet, where `--gap` rebinds to paper's own red
 * without this file knowing it has moved. `outline` and `ghost` are the only
 * two variants this app renders, so that is the invalid state an operator can
 * actually meet.
 *
 * `--lip` REACHES THE DISABLED RING AND NOT THE RESTING ONE, AND THAT IS A
 * `globals.css` DEFECT RATHER THAN A CHOICE HERE. The key's ring and shelf are
 * `box-shadow: var(--plate)`, and `--plate` is declared on `:root` as
 * `0 0 0 1.5px var(--lip, var(--btn-lip)), 0 var(--lip-h) 0 0 var(--lip, ...)`.
 * The var() references inside a custom property are substituted where that
 * property is DECLARED, so `--plate` resolves against `:root`, where `--lip`
 * is unset and the fallback wins; setting `--lip` on the control changes
 * nothing the shadow can see. MEASURED IN A BROWSER RATHER THAN REASONED
 * ABOUT, because the rule it contradicts says the opposite in as many words:
 * a `.lt-btn[data-tone="primary"]` computes the same neutral `--btn-lip`
 * shadow as an untoned key, and so does a key inside `.lt-paper`, whose own
 * `--btn-lip` rebind cannot reach `--plate` either. The one place `var(--lip)`
 * is written directly in a rule that matches the button, the disabled ring,
 * does pick the override up.
 *
 * So the declaration stays as it is. It is the right token, it paints the
 * disabled ring today, and it paints the whole key the day `--plate` is
 * declared where it is used instead of at `:root`. What does NOT belong here
 * is a second box-shadow spelling the ring and the shelf out again: that is
 * two definitions of the lip in two files, which is the exact thing this file
 * was rewritten to stop, bought for a state no screen in this app can
 * currently reach.
 *
 * SIZE IS PADDING, NOT HEIGHT, AND THE FLOOR IS 44px. `.lt-btn` sets
 * `min-height: 2.75rem`, so `h-8` would not have made a 32px button: it would
 * have made a 44px button carrying a dead utility, which is the kind of
 * declaration this codebase keeps finding after it has cost a day. The four
 * icon sizes collapse onto one 44px square for the same reason. They are kept
 * as names because callers name them, not because they differ.
 *
 * SIX THINGS THAT WERE HERE AND ARE DELIBERATELY GONE, five of which were
 * actively fighting `.lt-btn`:
 *
 * `border border-transparent`. On the key it is dead weight, and on the flat
 * control a transparent 1px border REPLACES the `--line-control` rule that is
 * its entire WCAG boundary. That is a control that looks finished and has no
 * edge.
 *
 * `rounded-lg`. It happens to resolve to the same 14px `.lt-btn` draws, which
 * is exactly why it is worth removing: a second place that has to keep
 * agreeing, and nothing that would say so if it stopped.
 *
 * `text-[0.8125rem] leading-[1.4] font-semibold`. Utilities beat
 * `@layer components`, so this would have shipped a generic button at 13px and
 * weight 600 next to operator keys at 14px and 700. Two buttons again, in the
 * one file whose job is that there is only one.
 *
 * `transition-[color,background-color,border-color]`. Same cascade, worse
 * outcome: it would have deleted `transform` and `box-shadow` from `.lt-btn`'s
 * own transition, and the press is a transform onto a box-shadow. The key
 * would have jumped rather than pressed, on the one gesture the design is
 * named for.
 *
 * `disabled:opacity-[0.42]`. `.lt-btn:disabled` already fades the ink to a
 * measured 55% mix, drops the lip, and rests the face where the lip was.
 * Multiplying an opacity over that dims a measured value to one nobody
 * measured. Every path base-ui can take is already covered by the class: a
 * native button gets the `disabled` attribute, and a non-native render or
 * `focusableWhenDisabled` gets `aria-disabled`, which is the second half of
 * `.lt-btn`'s own selector.
 *
 * `[&_svg:not([class*='size-'])]:size-4` and `group/button`. The icon set
 * sizes itself (`size` on every icon in `icons.tsx`, defaulting to the 16 a
 * control wants), so the CSS override could only ever contradict an explicit
 * `size={20}` without saying so, and nothing anywhere referenced the group.
 *
 * The `dark:` variants stay gone for the reason the old comment gave, and that
 * reason is still true: this app is one dark ground, nothing applies a `.dark`
 * class, and an unreachable branch in a style file teaches the next reader
 * that there are two grounds to keep working.
 */
const buttonVariants = cva(
  [
    "shrink-0 whitespace-nowrap select-none",
    // The refusal, on whichever boundary this variant actually draws. See the
    // doc comment: the flat control's rule moves, the key's ring does not yet.
    "aria-invalid:[--lip:var(--gap)] aria-invalid:[--line-control:var(--gap)]",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default: "lt-btn",
        secondary: "lt-btn",
        destructive: "lt-btn",
        outline: "lt-btn",
        ghost: "lt-btn",
        // Underline offset 3, matching the only other link rule in the
        // product (`DialogDescription`), so a link reads the same wherever it
        // is met.
        link: [
          "text-ink underline-offset-3 enabled:hover:underline",
          "disabled:cursor-not-allowed disabled:text-ink-3",
        ].join(" "),
      },
      size: {
        // The key's own padding is 1.1rem and the flat control's 0.75rem;
        // `default` says nothing, so each family keeps its own. The rest move
        // the padding only, because the height is the floor and the floor
        // does not move.
        xs: "px-3",
        sm: "px-3.5",
        default: "",
        lg: "px-6",
        // 44px square in both families: `size-11` sets a height that meets
        // the key's 44px minimum exactly and lifts the flat control off its
        // own 40px one, so an icon control is the same object either way.
        icon: "size-11 px-0",
        "icon-xs": "size-11 px-0",
        "icon-sm": "size-11 px-0",
        "icon-lg": "size-11 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>

/**
 * Which `.lt-btn` face each variant asks for, in one table rather than spread
 * through the component. `tone` mirrors `chrome.tsx`'s `Btn`, which also
 * writes `data-tone="default"` for the neutral key even though no rule matches
 * that value, so the two buttons emit the same markup for the same thing.
 */
const FACE: Record<
  ButtonVariant,
  { tone?: "default" | "primary" | "reject"; flat?: true }
> = {
  default: { tone: "primary" },
  secondary: { tone: "default" },
  destructive: { tone: "reject" },
  outline: { tone: "default", flat: true },
  ghost: { tone: "default", flat: true },
  link: {},
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const face = FACE[variant ?? "default"]
  return (
    <ButtonPrimitive
      data-slot="button"
      data-tone={face.tone}
      data-flat={face.flat ? "true" : undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
