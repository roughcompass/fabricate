"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { ITEM_GROUPS, TOOLBAR_ITEMS, type ToolbarItem, keyLabel, matchItems, useToolbar } from "./toolbar-context";
import { tooltipFor } from "./toolbar-tooltip";
import styles from "./toolbar.module.css";

/** The running application the menu's context row names. */
export interface MenuContext {
  readonly name: string;
  readonly environment: string;
  readonly status: string;
  /** Its page in Fabricate, opened in a new tab. */
  readonly href: string;
}

/**
 * The toolbar menu (template-demo/toolbar spec): a search field that filters
 * every item, a context row for the running application, a Shortcuts row, and
 * the items in their groups. The search field is a combobox that controls the
 * list: Up and Down move the highlight, Enter opens the highlighted item, and
 * Escape closes the menu.
 */
export function ToolbarMenu({ context, commentCount, highlight, onClose }: { context: MenuContext; commentCount: number; highlight: string | null; onClose: () => void }) {
  const { runItem, closeMenu } = useToolbar();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(highlight);
  const search = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const optionId = (item: ToolbarItem) => `${listId}-${item.id}`;

  const matches = matchItems(query);
  const filtering = query.trim() !== "";
  const current = matches.find((item) => item.id === highlighted) ?? (filtering ? matches[0] : undefined);

  useEffect(() => {
    search.current?.focus();
  }, []);

  const move = (step: 1 | -1) => {
    if (!matches.length) return;
    const index = current ? matches.indexOf(current) : step === 1 ? -1 : 0;
    setHighlighted(matches[(index + step + matches.length) % matches.length]!.id);
  };

  const close = () => {
    closeMenu();
    onClose();
  };

  return (
    <div role="dialog" aria-labelledby={titleId} className={styles.menu} data-toolbar-menu="">
      <div className={styles.menuHeader}>
        <h2 id={titleId} className={styles.menuTitle}>
          Demo toolbar
        </h2>
        <kbd className={styles.keyChip}>Esc</kbd>
      </div>
      <div className={styles.searchRow}>
        <Icon name="search" size={14} className={styles.searchIcon} />
        <input
          ref={search}
          className={styles.search}
          type="text"
          role="combobox"
          aria-label="What do you need?"
          aria-expanded={matches.length > 0}
          aria-controls={matches.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={current ? optionId(current) : undefined}
          placeholder="What do you need?"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setHighlighted(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              move(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter" && current) {
              event.preventDefault();
              runItem(current);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.nativeEvent.stopImmediatePropagation();
              close();
            }
          }}
        />
      </div>

      {!filtering && (
        <>
          <a href={context.href} target="_blank" rel="noopener" className={styles.contextRow} data-menu-context="">
            <span className={styles.contextName}>{context.name}</span>
            <span className={styles.contextMeta}>
              <span>{context.environment}</span>
              <span aria-hidden="true">·</span>
              <span>{context.status}</span>
            </span>
            <Icon name="external" size={14} />
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          <div role="group" aria-label="Shortcuts" className={styles.shortcutRow}>
            {TOOLBAR_ITEMS.filter((item) => item.shortcutRow).map((item) => (
              <button key={item.id} type="button" className={styles.roundButton} aria-label={item.name} aria-keyshortcuts={item.key ? keyLabel(item.key) : undefined} data-toolbar-item={item.id} onClick={(event) => runItem(item, event.currentTarget)} {...tooltipFor(item.name, item.key)}>
                <Icon name={item.icon} size={16} />
              </button>
            ))}
          </div>
        </>
      )}

      {matches.length > 0 ? (
      <div id={listId} role="listbox" aria-label="Tools" className={styles.items}>
        {ITEM_GROUPS.map((group) => {
          const items = matches.filter((item) => item.group === group);
          if (!items.length) return null;
          const groupId = `${listId}-${group}`;
          return (
            <div key={group} role="group" aria-labelledby={groupId} className={styles.group}>
              <div id={groupId} className={styles.groupLabel}>
                {group}
              </div>
              {items.map((item) => (
                <div
                  key={item.id}
                  id={optionId(item)}
                  role="option"
                  aria-label={item.id === "comments" && commentCount > 0 ? `${item.name}, ${commentCount} open` : item.name}
                  aria-keyshortcuts={item.key ? keyLabel(item.key) : undefined}
                  aria-selected={current?.id === item.id}
                  className={styles.item}
                  data-toolbar-item={item.id}
                  onPointerMove={() => setHighlighted(item.id)}
                  onClick={() => runItem(item)}
                >
                  <Icon name={item.icon} size={16} />
                  <span className={styles.itemName}>{item.name}</span>
                  {item.id === "comments" && commentCount > 0 && <span className={styles.itemCount}>{`${commentCount} open`}</span>}
                  {item.key && <kbd className={styles.keyChip}>{keyLabel(item.key)}</kbd>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      ) : (
        <p className={styles.noMatch} role="status">
          No matching tools
        </p>
      )}
    </div>
  );
}
