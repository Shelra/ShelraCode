import { SHORTCUT_GROUPS, SHORTCUTS } from "./shortcuts";
import type { SlashMenuItem } from "./slash-menu";
import { scrollbarStyle, type Theme } from "./theme";

const KEY_COLUMN = 15;
const COMMAND_COLUMN = 16;

function ShortcutColumn({ t }: { t: Theme }) {
  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1}>
      {SHORTCUT_GROUPS.map((group, index) => (
        <box key={group} flexDirection="column" paddingTop={index === 0 ? 0 : 1}>
          <text fg={t.textMuted}>
            <b>{group}</b>
          </text>
          {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
            <text key={`${group}:${shortcut.keys}:${shortcut.label}`} wrapMode="none">
              <span style={{ fg: t.text }}>{shortcut.keys.padEnd(KEY_COLUMN)}</span>
              <span style={{ fg: t.textMuted }}>{shortcut.label}</span>
            </text>
          ))}
        </box>
      ))}
    </box>
  );
}

function CommandColumn({ t, commands, room }: { t: Theme; commands: readonly SlashMenuItem[]; room: number }) {
  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1}>
      <text fg={t.textMuted}>
        <b>{"Commands"}</b>
      </text>
      {commands.map((command) => (
        <text key={command.id} wrapMode="none">
          <span style={{ fg: t.text }}>{`/${command.label}`.padEnd(COMMAND_COLUMN)}</span>
          <span style={{ fg: t.textMuted }}>{command.description.slice(0, Math.max(10, room - COMMAND_COLUMN))}</span>
        </text>
      ))}
    </box>
  );
}

/**
 * One reference for the whole keyboard and command surface. Wide terminals show both side by
 * side; narrow ones stack them in a scrollable panel. Esc, Enter or ? closes it.
 */
export function HelpModal({
  t,
  width,
  height,
  commands,
}: {
  t: Theme;
  width: number;
  height: number;
  commands: readonly SlashMenuItem[];
}) {
  const panelWidth = Math.min(112, width - 4);
  const sideBySide = panelWidth >= 96;
  const columnRoom = sideBySide ? Math.floor((panelWidth - 8) / 2) : panelWidth - 6;
  const contentHeight = sideBySide
    ? Math.max(SHORTCUT_GROUPS.length * 2 + SHORTCUTS.length + 3, commands.length + 2)
    : SHORTCUTS.length + commands.length + 10;
  const panelHeight = Math.min(contentHeight + 6, height - 2);
  const top = Math.max(1, Math.floor((height - panelHeight) / 2));

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
      zIndex={400}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" paddingLeft={3} paddingRight={3}>
          <text fg={t.primary}>
            <b>{"Keyboard and commands"}</b>
          </text>
          <box flexGrow={1} />
          <text fg={t.textMuted}>{"esc close"}</text>
        </box>
        <scrollbox
          scrollbarOptions={scrollbarStyle(t)}
          flexGrow={1}
          minHeight={0}
          paddingLeft={3}
          paddingRight={3}
          paddingTop={1}
        >
          {sideBySide ? (
            <box flexDirection="row" gap={4}>
              <ShortcutColumn t={t} />
              <CommandColumn t={t} commands={commands} room={columnRoom} />
            </box>
          ) : (
            <box flexDirection="column" gap={1}>
              <ShortcutColumn t={t} />
              <CommandColumn t={t} commands={commands} room={columnRoom} />
            </box>
          )}
        </scrollbox>
      </box>
    </box>
  );
}
