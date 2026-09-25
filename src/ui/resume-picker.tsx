import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { SessionListing } from "../storage/sessions";
import { truncateText } from "./activity";
import { SectionBadge } from "./components/badge";
import { chatFolder, chatLabel, chatMeta, wrapWords } from "./resume";
import { scrollbarStyle, type Theme } from "./theme";

export interface ResumePickerProps {
  t: Theme;
  chats: readonly SessionListing[];
  selectedIndex: number;
  /** The list spans every folder, not only this one. */
  all: boolean;
  width: number;
  height: number;
  /** Why the chosen chat could not be opened; the picker stays open to show it. */
  error: string | null;
  now: Date;
}

/**
 * /resume: the chats saved in this folder (or every folder), newest first, each with what it was about,
 * its size, when it was last used and the model. Enter continues the chosen chat in place.
 */
export function ResumePickerModal({ t, chats, selectedIndex, all, width, height, error, now }: ResumePickerProps) {
  const listRef = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    const chat = chats[selectedIndex];
    if (chat) listRef.current?.scrollChildIntoView(`chat-${chat.id}`);
  }, [selectedIndex, chats]);

  const panelWidth = Math.min(76, width - 6);
  const room = Math.max(16, panelWidth - 6);
  // Two rows per chat, inside the borders, the header and its gap, and the key hints with theirs. The
  // scrollbox needs one row more than its rows to show them all, or it cuts the last one behind a bar.
  // A reason is shown whole, on as many lines as it takes: it can carry a command to copy.
  const reason = error ? wrapWords(error, room) : [];
  const contentHeight = Math.max(chats.length, 1) * 2 + 7 + reason.length;
  const panelHeight = Math.min(contentHeight, Math.floor(height * 0.7));
  const top = Math.max(2, Math.floor((height - panelHeight) / 2));
  const scope = all ? "every folder" : "this folder";
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={t.overlay}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.background}
        border={["top", "right", "bottom", "left"]}
        borderStyle="single"
        borderColor={t.border}
        flexDirection="column"
      >
        <box
          flexShrink={0}
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={2}
          paddingRight={2}
          paddingBottom={1}
        >
          <SectionBadge
            t={t}
            label="Resume"
            detail={`${chats.length} chat${chats.length === 1 ? "" : "s"} · ${scope}`}
          />
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <scrollbox scrollbarOptions={scrollbarStyle(t)} ref={listRef} flexGrow={1} minHeight={0}>
          {chats.map((chat, index) => {
            const selected = index === selectedIndex;
            // Across every folder, the folder sits on the title line's right, so the title gives way first.
            const folder = all ? chatFolder(chat, Math.min(30, Math.floor(room / 2))) : "";
            const label = truncateText(chatLabel(chat), Math.max(8, room - (folder ? folder.length + 2 : 0)));
            return (
              <box
                key={chat.id}
                id={`chat-${chat.id}`}
                backgroundColor={selected ? t.selectedBg : undefined}
                paddingLeft={2}
                paddingRight={2}
                width="100%"
                flexDirection="column"
              >
                <box width="100%" flexDirection="row" justifyContent="space-between">
                  <text fg={selected ? t.brand : t.text} wrapMode="none">
                    {label}
                  </text>
                  {folder ? (
                    <text fg={selected ? t.textSecondary : t.textDim} wrapMode="none">
                      {folder}
                    </text>
                  ) : null}
                </box>
                <text fg={selected ? t.textSecondary : t.textDim} wrapMode="none">
                  {truncateText(chatMeta(chat, now), room)}
                </text>
              </box>
            );
          })}
          {chats.length === 0 ? (
            <box paddingLeft={2} paddingRight={2}>
              <text fg={t.textMuted}>{all ? "No earlier chats yet." : "No earlier chats in this folder."}</text>
            </box>
          ) : null}
        </scrollbox>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="column">
          {reason.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one message, in order
            <text key={index} fg={t.danger} wrapMode="none">
              {line}
            </text>
          ))}
          <text fg={t.textMuted} wrapMode="none">
            {`${chats.length > 0 ? "enter continue  " : ""}tab ${all ? "this folder" : "every folder"}  esc close`}
          </text>
        </box>
      </box>
    </box>
  );
}
