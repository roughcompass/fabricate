"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { useHints } from "./guided-hints";
import { TOOLBAR_ITEMS, keyLabel } from "./toolbar-context";
import { ToolPanel } from "./tool-panel";
import { setToolbarPrefs, useToolbarPrefs } from "./toolbar-prefs";
import styles from "./toolbar.module.css";

/**
 * Preferences › Keyboard shortcuts: every toolbar item with its fixed key,
 * the switch that turns single keys off, and, over a running application, the
 * guided hints' switch and Replay hints for the workspace.
 */
export function ShortcutsPanel() {
  const prefs = useToolbarPrefs();
  const hints = useHints();
  const rows: { id: string; icon: React.ComponentProps<typeof Icon>["name"]; name: string; key: string }[] = [
    ...TOOLBAR_ITEMS.filter((item) => item.key).map((item) => ({ id: item.id, icon: item.icon, name: item.id === "comment" ? "Start or stop comment mode" : item.id === "hide" ? "Hide or show the toolbar" : item.name, key: keyLabel(item.key!) })),
    { id: "escape", icon: "x", name: "Close the menu or panel, or leave the current mode", key: "Esc" },
  ];
  return (
    <ToolPanel title="Preferences / Keyboard shortcuts" description="Shortcuts work anywhere on the page except while typing in a field.">
      <ul className={styles.shortcuts} aria-label="Keyboard shortcuts">
        {rows.map((row) => (
          <li key={row.id} className={styles.shortcut} data-shortcut={row.id}>
            <Icon name={row.icon} size={16} />
            <span className={styles.shortcutName}>{row.name}</span>
            <kbd className={styles.keyChip}>{row.key}</kbd>
          </li>
        ))}
      </ul>
      <Checkbox
        id="toolbar-shortcuts"
        label="Use single-key shortcuts"
        description="Turn off if they conflict with your browser or assistive technology. Esc always works."
        checked={prefs.shortcuts}
        onChange={(event) => setToolbarPrefs({ shortcuts: event.currentTarget.checked })}
      />
      {hints && (
        <section className={styles.preferences} aria-labelledby="hints-title">
          <h3 id="hints-title" className={styles.preferencesTitle}>
            Guided hints
          </h3>
          <Checkbox id="hints-on" label="Show guided hints" description="Short tips that point to the toolbar's tools in running applications, for this workspace." checked={!hints.state.off} onChange={(event) => hints.act(event.currentTarget.checked ? "on" : "off")} />
          <div>
            <Button icon="undo" onClick={() => hints.act("replay")} disabled={hints.state.off}>
              Replay hints
            </Button>
          </div>
        </section>
      )}
    </ToolPanel>
  );
}
