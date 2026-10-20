"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, TextInput } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Panel } from "@/components/ui/panel";
import { Tag } from "@/components/ui/tag";
import { type Experience, LIMITS, type MenuNode, menuDepth, validateExperience } from "@/lib/experience/document";
import { useEditor } from "./store";
import styles from "./messages.module.css";
import menu from "./menu.module.css";
import { editorBase } from "@/lib/portals/paths";

type Draft = { kind: "item" | "group"; label: string; route: string; application: string; parentId: string };

const newId = () => `tmp_${Math.random().toString(36).slice(2, 10)}`;

/** Every entry inside +id+, at any depth. */
function descendants(nodes: readonly MenuNode[], id: string): Set<string> {
  const inside = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const node of nodes) if (node.parentId && (node.parentId === id || inside.has(node.parentId)) && !inside.has(node.id)) { inside.add(node.id); grew = true; }
  }
  return inside;
}

/**
 * The menu editor (navigation spec, "The menu is edited directly"): the
 * Portal's menu as a tree, edited as pending changes of its experience: add
 * a group or an item, rename, move up, down, or into a group, remove, and
 * choose the default. Routes and Applications are checked as they're
 * entered; `?add=<application>` starts an item for that Application.
 */
export function MenuView() {
  const editor = useEditor();
  const params = useSearchParams();
  const requested = params.get("add");
  const startFor = editor.applications.find((application) => application.publicId === requested);
  const [draft, setDraft] = useState<Draft | null>(startFor ? { kind: "item", label: startFor.name, route: startFor.slug ? `/${startFor.slug}` : "", application: startFor.publicId, parentId: "" } : null);
  const [draftErrors, setDraftErrors] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const nodes = editor.present.menu;
  const base = editorBase(editor.portal.publicId);
  const groups = nodes.filter((node) => node.kind === "group");
  const label = (node: MenuNode) => {
    const names = [node.label];
    for (let parent = nodes.find((candidate) => candidate.id === node.parentId); parent; parent = nodes.find((candidate) => candidate.id === parent!.parentId)) names.unshift(parent.label);
    return names.join(" › ");
  };
  const applicationName = (id: string | null) => editor.applications.find((application) => application.publicId === id)?.name ?? "Unknown Application";

  const siblingsMove = (node: MenuNode, by: -1 | 1) =>
    editor.edit((doc) => {
      const siblings = doc.menu.filter((candidate) => candidate.parentId === node.parentId);
      const at = siblings.findIndex((candidate) => candidate.id === node.id);
      const other = siblings[at + by];
      if (!other) return;
      const [a, b] = [doc.menu.findIndex((candidate) => candidate.id === node.id), doc.menu.findIndex((candidate) => candidate.id === other.id)];
      [doc.menu[a], doc.menu[b]] = [doc.menu[b]!, doc.menu[a]!];
    });

  const addDraft = () => {
    if (!draft) return;
    const node: MenuNode = { id: newId(), parentId: draft.parentId || null, kind: draft.kind, label: draft.label.trim(), route: draft.kind === "item" ? draft.route.trim() : null, application: draft.kind === "item" ? draft.application || null : null, isDefault: false };
    const candidate: Experience = { ...editor.present, menu: [...editor.present.menu, node] };
    const index = candidate.menu.length - 1;
    const issues = validateExperience(candidate, { catalogs: editor.catalogs, applications: editor.applications }).filter((issue) => issue.path.startsWith(`menu.${index}.`));
    if (issues.length) {
      setDraftErrors(Object.fromEntries(["label", "route", "application", "parentId"].map((field) => [field, issues.filter((issue) => issue.path === `menu.${index}.${field}`).map((issue) => issue.message)])));
      return;
    }
    editor.edit((doc) => void doc.menu.push(node));
    setDraft(null);
    setDraftErrors({});
  };

  const tree = (parent: string | null): React.ReactNode => {
    const children = nodes.filter((node) => node.parentId === parent);
    if (children.length === 0) return parent ? <p className={menu.empty}>Empty</p> : null;
    return (
      <ul className={menu.tree} aria-label={parent ? undefined : "Menu"}>
        {children.map((node, position) => {
          const index = nodes.indexOf(node);
          const holds = nodes.some((candidate) => candidate.parentId === node.id);
          const routeErrors = editor.errorsAt(`menu.${index}.route`);
          return (
            <li key={node.id}>
              <div className={menu.entry} data-kind={node.kind} data-entry={node.label}>
                <Icon name={node.kind === "group" ? "folder" : "link"} size={14} />
                <span className={menu.main}>
                  <span className={menu.label}>{node.label}</span>
                  {node.kind === "item" && (
                    <>
                      <Tag>{node.route ?? ""}</Tag>
                      <span className={menu.application}>{applicationName(node.application)}</span>
                    </>
                  )}
                  {node.isDefault && <Tag sans>Default</Tag>}
                  {routeErrors && <span className={menu.error}>{routeErrors.join(" ")}</span>}
                </span>
                <span className={menu.actions}>
                  <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label={`Move ${node.label} up`} disabled={position === 0} onClick={() => siblingsMove(node, -1)}>
                    <Icon name="arrowUp" size={14} />
                  </button>
                  <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label={`Move ${node.label} down`} disabled={position === children.length - 1} onClick={() => siblingsMove(node, 1)}>
                    <Icon name="arrowDown" size={14} />
                  </button>
                  <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label={`Edit ${node.label}`} onClick={() => { setDraft(null); setEditing(node.id); }}>
                    <Icon name="edit" size={14} />
                  </button>
                  {node.kind === "item" && !node.isDefault && (
                    <button type="button" {...buttonProps("tertiary", "sm")} onClick={() => editor.edit((doc) => doc.menu.forEach((candidate) => void (candidate.isDefault = candidate.id === node.id)))}>
                      Make default
                    </button>
                  )}
                  <button
                    type="button"
                    {...buttonProps("tertiary", "sm", true)}
                    aria-label={holds ? `Remove ${node.label} (move or remove what's in it first)` : `Remove ${node.label}`}
                    title={holds ? "Move or remove what's in it first" : `Remove ${node.label}`}
                    disabled={holds}
                    onClick={() => {
                      if (editing === node.id) setEditing(null);
                      editor.edit((doc) => void (doc.menu = doc.menu.filter((candidate) => candidate.id !== node.id)));
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </div>
              {node.kind === "group" && tree(node.id)}
            </li>
          );
        })}
      </ul>
    );
  };

  const current = editing ? nodes.find((node) => node.id === editing) : null;
  const currentIndex = current ? nodes.indexOf(current) : -1;
  const hasDefault = nodes.some((node) => node.isDefault);

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <ButtonLink href={`${base}/frame-zones`} variant="tertiary" size="sm" icon="arrowLeft">
          Back to workspace
        </ButtonLink>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Menu</h2>
          <p className={styles.summary}>{`${nodes.filter((node) => node.parentId === null).length} top-level items · each change is pending until you save`}</p>
          <button type="button" {...buttonProps("secondary", "sm")} onClick={() => { setEditing(null); setDraftErrors({}); setDraft({ kind: "group", label: "", route: "", application: "", parentId: "" }); }}>
            <Icon name="folder" size={14} />
            Add group
          </button>
          <button type="button" {...buttonProps("primary", "sm")} onClick={() => { setEditing(null); setDraftErrors({}); setDraft({ kind: "item", label: "", route: "", application: "", parentId: "" }); }}>
            <Icon name="plus" size={14} />
            Add item
          </button>
        </div>
        {nodes.some((node) => node.kind === "item") && !hasDefault && <p className={menu.warning} role="status">{`${editor.portal.label} has no default route. Choose Make default on an item: it's where people land, and promoting to Production needs one.`}</p>}
        <Panel>{nodes.length > 0 ? tree(null) : <EmptyState title="No menu yet" icon="network">{`Add an item to route a path in ${editor.portal.label} to one of its Applications, and a group to hold items.`}</EmptyState>}</Panel>
      </div>
      {draft && (
        <aside className={styles.panel} aria-label={draft.kind === "item" ? "Add a menu item" : "Add a menu group"}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>{draft.kind === "item" ? `Add a menu item to ${editor.portal.label}` : `Add a menu group to ${editor.portal.label}`}</h3>
            <button type="button" {...buttonProps("tertiary", "sm")} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
          <TextInput id="draft-label" label="Label" value={draft.label} maxLength={LIMITS.menuLabel} errors={draftErrors.label?.length ? draftErrors.label : undefined} onChange={(event) => setDraft({ ...draft, label: event.target.value })} description={draft.kind === "item" ? "What people see in the menu, such as Payees." : "Such as Payments."} />
          {draft.kind === "item" && (
            <>
              <TextInput id="draft-route" label="Route" mono value={draft.route} autoComplete="off" errors={draftErrors.route?.length ? draftErrors.route : undefined} onChange={(event) => setDraft({ ...draft, route: event.target.value })} description="Starts with / and uses lowercase letters, digits, hyphens, and slashes, such as /payees. Each route is used once in the Portal." />
              <Select id="draft-application" label="Application" value={draft.application} errors={draftErrors.application?.length ? draftErrors.application : undefined} description={`Only Applications registered in ${editor.portal.label} are offered.`} options={[{ value: "", label: "Choose an Application" }, ...editor.applications.map((application) => ({ value: application.publicId, label: application.slug ? `${application.name} (${application.slug})` : application.name }))]} onChange={(event) => setDraft({ ...draft, application: event.target.value })} />
            </>
          )}
          <Select id="draft-parent" label={draft.kind === "item" ? "Group" : "Inside"} value={draft.parentId} errors={draftErrors.parentId?.length ? draftErrors.parentId : undefined} options={[{ value: "", label: "Top level" }, ...groups.filter((group) => menuDepth(nodes, group) < LIMITS.menuDepth).map((group) => ({ value: group.id, label: label(group) }))]} onChange={(event) => setDraft({ ...draft, parentId: event.target.value })} />
          <button type="button" {...buttonProps("primary")} onClick={addDraft}>
            {draft.kind === "item" ? "Add item" : "Add group"}
          </button>
        </aside>
      )}
      {current && (
        <aside className={styles.panel} aria-label={`Edit ${current.label}`}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>{`Edit ${current.kind === "group" ? "group" : "item"}`}</h3>
            <button type="button" {...buttonProps("tertiary", "sm")} onClick={() => setEditing(null)}>
              Close
            </button>
          </div>
          <TextInput id="entry-label" label="Label" value={current.label} maxLength={LIMITS.menuLabel} errors={editor.errorsAt(`menu.${currentIndex}.label`)} onChange={(event) => editor.edit((doc) => void (doc.menu[currentIndex]!.label = event.target.value), `menu.${current.id}.label`)} onBlur={editor.seal} />
          {current.kind === "item" && (
            <>
              <TextInput id="entry-route" label="Route" mono value={current.route ?? ""} errors={editor.errorsAt(`menu.${currentIndex}.route`)} onChange={(event) => editor.edit((doc) => void (doc.menu[currentIndex]!.route = event.target.value), `menu.${current.id}.route`)} onBlur={editor.seal} />
              <Select id="entry-application" label="Application" value={current.application ?? ""} errors={editor.errorsAt(`menu.${currentIndex}.application`)} options={[{ value: "", label: "Choose an Application" }, ...editor.applications.map((application) => ({ value: application.publicId, label: application.name }))]} onChange={(event) => editor.edit((doc) => void (doc.menu[currentIndex]!.application = event.target.value || null))} />
            </>
          )}
          <Select
            id="entry-parent"
            label="Move to a group"
            value={current.parentId ?? ""}
            errors={editor.errorsAt(`menu.${currentIndex}.parentId`)}
            description="It goes at the end of the group you choose, with everything it holds."
            options={[{ value: "", label: "Top level" }, ...groups.filter((group) => group.id !== current.id && !descendants(nodes, current.id).has(group.id)).map((group) => ({ value: group.id, label: label(group) }))]}
            onChange={(event) =>
              editor.edit((doc) => {
                const moving = doc.menu.splice(currentIndex, 1)[0]!;
                moving.parentId = event.target.value || null;
                doc.menu.push(moving);
                // What it holds follows it, after it.
                const inside = descendants(doc.menu, moving.id);
                const held = doc.menu.filter((node) => inside.has(node.id));
                doc.menu = [...doc.menu.filter((node) => !inside.has(node.id)), ...held];
              })
            }
          />
        </aside>
      )}
    </div>
  );
}
