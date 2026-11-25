import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-jf-brand active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "rounded-xl bg-jf-brand font-semibold text-jf-on-brand hover:bg-jf-brand-dark focus-visible:ring-offset-2 dark:hover:bg-jf-brand/85",
        outline:
          "rounded-lg border border-jf-field-border bg-jf-surface text-jf-ink hover:bg-jf-chip aria-expanded:bg-jf-chip",
        ghost: "rounded-lg text-jf-ink hover:bg-jf-chip aria-expanded:bg-jf-chip",
        danger:
          "rounded-lg border border-jf-danger-fg bg-jf-surface text-jf-danger-fg hover:bg-jf-chip",
        link: "rounded-lg text-jf-brand underline-offset-4 hover:underline",
      },
      size: {
        md: "min-h-11 gap-1.5 px-4 text-sm md:min-h-9",
        sm: "min-h-11 gap-1 px-3 text-[0.8rem] md:min-h-8",
        icon: "size-11 md:size-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "md",
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
