import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The generic button.
 *
 * IT HAS TO AGREE WITH `.lt-btn`, which is the operator screens' button and is
 * not going away. What this file used to be was the second half of a product
 * with two design systems: a primitive hardwired to a light palette that
 * nothing imported, sitting next to a hand-rolled class that every screen used
 * and that looked nothing like it. So every number below is `.lt-btn`'s own
 * number, read off `globals.css`: a 4px radius, 13px at weight 600, 32px tall,
 * a 1px rule for a border, and the same three tones.
 *
 *   variant="default"      is .lt-btn[data-tone="primary"], ink on the ground
 *   variant="outline"      is .lt-btn, a ruled outline
 *   variant="destructive"  is .lt-btn[data-tone="reject"], the correction pen
 *
 * THE RADIUS SCALE. `--radius` is 0.25rem, so `rounded-lg` (which the theme
 * maps to `var(--radius)`) is exactly the 4px `.lt-btn` draws, and every size
 * below takes it: a button does not change material when it changes size. The
 * `rounded-[min(var(--radius-md), 10px)]` clamps that used to sit on the
 * small sizes came from shadcn's 0.625rem default, where the scale ran past
 * 10px and the min() had something to do. Against a 4px radius it can never
 * bind, so they were three spellings of one slightly-too-small number.
 *
 * FOUR THINGS THAT WERE HERE AND ARE DELIBERATELY GONE:
 *
 * `dark:` variants. This app is one dark surface and nothing anywhere applies
 * a `.dark` class, so every `dark:` rule in this directory was a branch that
 * could not be reached. An unreachable branch in a style file is worse than no
 * branch: the next reader assumes there are two grounds to keep working.
 *
 * An `outline: none` utility and the focus ring it substituted. Utilities beat
 * `@layer base`, so that outline was quietly cancelling the one focus rule
 * the product has, `:focus-visible { outline: 2px solid var(--ink) }`, and
 * putting a half-transparent halo where an ink outline belongs. Focus is ink
 * here, it is defined once, and a primitive does not get to opt out of it.
 * That same base rule also sets `border-radius: 2px`, which is why every
 * variant carries an explicit radius: without one, a button would change shape
 * the moment it was focused.
 *
 * A one-pixel `translate-y` on `:active`. The product has exactly one moment
 * of motion, the paraf being drawn under the operator's own click, and a
 * button that drops a pixel is not it. It is also the one piece of motion in
 * this file that `prefers-reduced-motion` cannot switch off, because it is a
 * state style rather than a transition or an animation.
 *
 * A blanket `transition-property: all`, narrowed to the three properties that
 * actually change. Transitioning everything is how a layout property ends up
 * animating by accident, and here it was animating the focus outline as well.
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-1.5",
    "rounded-lg border border-transparent bg-clip-padding",
    "text-[0.8125rem] leading-[1.4] font-semibold whitespace-nowrap select-none",
    "transition-[color,background-color,border-color] duration-[90ms]",
    "disabled:cursor-not-allowed disabled:opacity-[0.42]",
    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-[0.42]",
    // A refusal is a rule, never a wash: the invalid state moves the border,
    // it does not tint the control.
    "aria-invalid:border-destructive",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        // The action a screen wants taken, Terima included: bright on dark,
        // the light switch on a dark panel. It carries no hue, because
        // accepting is not a state that owes anything.
        default:
          "border-primary bg-primary text-primary-foreground enabled:hover:border-ink-2 enabled:hover:bg-ink-2",
        outline:
          "border-border text-foreground enabled:hover:border-line-strong enabled:hover:bg-foreground/8 aria-expanded:bg-accent",
        secondary:
          "border-border bg-secondary text-secondary-foreground enabled:hover:border-line-strong enabled:hover:bg-accent aria-expanded:bg-accent",
        ghost:
          "text-foreground enabled:hover:bg-foreground/8 aria-expanded:bg-accent",
        // Refusing is a smaller, rarer claim than accepting, so it is outlined
        // where accept is filled, and it wears the correction pen because that
        // is what a refusal is. `--gap` is a rule, a stroke and a text colour,
        // never a fill, so the only red ground here is the 10% wash `.lt-btn`
        // uses on hover to say the pointer has arrived.
        destructive: [
          "border-[color-mix(in_oklch,var(--gap),transparent_55%)]",
          "text-[color-mix(in_oklch,var(--gap),white_20%)]",
          "enabled:hover:border-destructive enabled:hover:bg-destructive/10",
        ].join(" "),
        link: "text-foreground underline-offset-4 enabled:hover:underline",
      },
      size: {
        // Nothing in this product is set below 13px, because every small
        // string here is safety copy, so the small sizes get smaller by height
        // and padding and never by type size.
        xs: "h-6 px-2",
        sm: "h-7 px-2.5",
        default: "h-8 px-3",
        lg: "h-9 px-3.5",
        icon: "size-8",
        "icon-xs": "size-6",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
