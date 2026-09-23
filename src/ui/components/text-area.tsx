import type { TextareaProps } from "@opentui/react";
import { useCallback, useRef } from "react";

type Props = Omit<TextareaProps, "onSubmit"> & { onSubmit?: () => void };

/**
 * A <textarea> whose Enter handler never goes stale. OpenTUI's React reconciler applies an
 * `onSubmit` update only to <input>; a <textarea> keeps the handler it was created with, so
 * every value that handler closes over is frozen at the first render. Seen 2026-09-22: the
 * composer still saw mode "agent" after the user switched to plan mode, so the plan questions
 * never opened. The textarea gets one stable function that calls the latest handler.
 */
export function TextArea({ onSubmit, ...props }: Props) {
  const latest = useRef(onSubmit);
  latest.current = onSubmit;
  const submit = useCallback(() => latest.current?.(), []);
  return <textarea {...props} onSubmit={submit as unknown as TextareaProps["onSubmit"]} />;
}
