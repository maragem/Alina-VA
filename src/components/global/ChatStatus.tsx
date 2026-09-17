import {
  CircleAlert,
  CircleStop,
  LoaderCircle,
  Search,
  Wrench,
  BrainCircuit,
  type LucideIcon,
} from "lucide-react";
import type { AssistantMessageStatus } from "./hooks/useChat";
import { CHAT_STATUS, type ChatStatus as HaystackStatus } from "./hooks/useHaystackStream";

type ChatStatusProps = {
  activeToolName?: string | null;
  errorMessage?: string;
  messageStatus: AssistantMessageStatus;
  streamStatus: HaystackStatus;
};

type StatusPresentation = {
  Icon: LucideIcon;
  chipClassName: string;
  iconClassName?: string;
  label: string;
};

function getPresentation({
  activeToolName,
  messageStatus,
  streamStatus,
}: ChatStatusProps): StatusPresentation {
  if (messageStatus === "error") {
    return {
      Icon: CircleAlert,
      chipClassName: "border-rose-200 bg-rose-50 text-rose-800",
      label: "Error",
    };
  }

  if (messageStatus === "pending" || streamStatus === CHAT_STATUS.connecting) {
    return {
      Icon: Search,
      chipClassName: "border-blue-200 bg-blue-50 text-blue-800",
      iconClassName: "motion-safe:animate-pulse",
      label: "Connecting",
    };
  }

  if (streamStatus === CHAT_STATUS.tool_calling) {
    const name = activeToolName ?? "tool";
    return {
      Icon: Wrench,
      chipClassName: "border-violet-200 bg-violet-50 text-violet-800",
      iconClassName: "motion-safe:animate-pulse",
      label: `Calling ${name}`,
    };
  }

  if (streamStatus === CHAT_STATUS.tool_called) {
    return {
      Icon: Search,
      chipClassName: "border-blue-200 bg-blue-50 text-blue-800",
      iconClassName: "motion-safe:animate-pulse",
      label: "Processing results",
    };
  }

  if (streamStatus === CHAT_STATUS.reasoning) {
    return {
      Icon: BrainCircuit,
      chipClassName: "border-amber-200 bg-amber-50 text-amber-800",
      iconClassName: "motion-safe:animate-pulse",
      label: "Analysing",
    };
  }

  if (messageStatus === "streaming") {
    return {
      Icon: LoaderCircle,
      chipClassName: "border-emerald-200 bg-emerald-50 text-emerald-800",
      iconClassName: "motion-safe:animate-spin",
      label: "Generating response",
    };
  }

  return {
    Icon: CircleStop,
    chipClassName: "border-slate-200 bg-slate-50 text-slate-600",
    label: "Response stopped",
  };
}

export function ChatStatus(props: ChatStatusProps) {
  const { Icon, chipClassName, iconClassName, label } = getPresentation(props);
  const isActive =
    props.messageStatus === "pending" || props.messageStatus === "streaming";

  return (
    <div className="mt-3">
      <div
        key={label}
        className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 shadow-xs transition-colors duration-300 text-xs font-medium animate-status-fade ${chipClassName}`}
        role="status"
        aria-live="polite"
      >
        <Icon
          className={`size-3.5 ${iconClassName ?? ""}`}
          aria-hidden="true"
        />
        <span>
          {label}
          {isActive ? (
            <span
              className="ml-0.5 inline-flex w-3.5 justify-start align-baseline"
              aria-hidden="true"
            >
              <span className="animate-status-dots">...</span>
            </span>
          ) : null}
        </span>
      </div>
      {props.messageStatus === "error" && props.errorMessage ? (
        <p className="mt-2 text-sm text-rose-700">{props.errorMessage}</p>
      ) : null}
    </div>
  );
}
