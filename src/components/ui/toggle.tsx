import { cva, type VariantProps } from "class-variance-authority";

// Only `toggleVariants` is used (by ToggleGroup). The standalone `Toggle`
// component was never imported anywhere, so it has been removed.

// The selected ("on") look is driven by the explicit `data-active` flag set on
// mode/tool items and styled in index.css (solid primary, matching the main
// `Button variant="default"`). Radix's `data-state="on"` is unreliable under
// the Tooltip asChild clone, so we don't style off it here. Only the unselected
// ("off") rest/hover styling lives in the variant.
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 select-none data-[state=off]:border data-[state=off]:border-transparent data-[state=off]:text-foreground/80 data-[state=off]:hover:bg-secondary",
  {
    variants: {
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2 text-xs",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export { toggleVariants };
export type ToggleVariantProps = VariantProps<typeof toggleVariants>;
