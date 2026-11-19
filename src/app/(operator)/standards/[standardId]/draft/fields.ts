/**
 * The props that tie a field named +name+ under +path+ to the draft: its ID,
 * the errors reported for it, and the issue path the issue list focuses.
 */
export function fieldProps(idPrefix: string, path: string, errorsFor: (path: string) => string[]) {
  return (name: string) => ({ id: `${idPrefix}-${name}`, errors: errorsFor(`${path}.${name}`), "data-issue-path": `${path}.${name}` });
}
