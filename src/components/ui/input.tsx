import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full rounded-md border border-(--ec-line) bg-white px-3 py-2 text-sm text-(--ec-ink) shadow-xs transition-colors outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-(--ec-mute) disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-(--ec-blue) focus-visible:ring-2 focus-visible:ring-[rgba(255,204,0,0.6)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
