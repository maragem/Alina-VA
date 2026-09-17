import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-(--ec-blue) text-white",
        secondary: "border-transparent bg-slate-100 text-slate-900",
        outline: "border-(--ec-line) text-(--ec-ink)",
        info: "border-transparent bg-blue-50 text-blue-800",
        success: "border-transparent bg-emerald-50 text-emerald-800",
        warning: "border-transparent bg-amber-50 text-amber-800",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
