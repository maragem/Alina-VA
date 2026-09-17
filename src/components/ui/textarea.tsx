import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full resize-none rounded-md border border-(--ec-line) bg-white px-3 py-2 text-sm leading-6 text-(--ec-ink) shadow-xs transition-colors outline-none placeholder:text-(--ec-mute) disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-(--ec-blue) focus-visible:ring-2 focus-visible:ring-[rgba(255,204,0,0.6)]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };