"use client";

import { Checkbox } from "@/components/ui/form";
import { TOOL_BUTTONS } from "./toolbar-context";
import { ToolPanel } from "./tool-panel";
import { setToolbarPrefs, useToolbarPrefs } from "./toolbar-prefs";
import styles from "./toolbar.module.css";

/** The toolbar's single-key shortcuts, and the switch that turns them off. */
export function ShortcutsPanel() {
  const prefs = useToolbarPrefs();
  const rows: [key: string, action: string][] = [
    ["C", "Start or stop comment mode"],
    ...TOOL_BUTTONS.filter((button) => button.tool !== "comments").map((button): [string, string] => [button.key.toUpperCase(), button.label]),
    [".", "Collapse or show the toolbar"],
    ["?", "Show keyboard shortcuts"],
    ["Esc", "Close the open panel or leave the current mode"],
  ];
  return (
    <ToolPanel title="Keyboard shortcuts" description="Shortcuts work anywhere on the page except while typing in a field.">
      <dl className={styles.shortcuts}>
        {rows.map(([key, action]) => (
          <div key={key} className={styles.shortcut}>
            <dt>
              <kbd className={styles.kbd}>{key}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <Checkbox
        id="toolbar-shortcuts"
        label="Use single-key shortcuts"
        description="Turn off if they conflict with your browser or assistive technology. Esc always works."
        checked={prefs.shortcuts}
        onChange={(event) => setToolbarPrefs({ shortcuts: event.currentTarget.checked })}
      />
    </ToolPanel>
  );
}
