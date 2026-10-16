import { type ComponentType, type ReactElement, createElement } from "react";
import { GENERATED_MEMBERS } from "./generated";
import { GENERIC_MEMBERS } from "./members/generic";
import { GLOBAL_BANKING_MEMBERS } from "./members/global-banking";
import { MARKETS_MEMBERS } from "./members/markets";
import { OPERATIONS_MEMBERS } from "./members/operations";
import { PAYMENTS_MEMBERS } from "./members/payments";

/**
 * Every microfrontend version the runtime can render, by member and version
 * (design.md, decision 6). A static map, so a version swap never needs a
 * computed import(). The catalog test checks that it covers every version.
 */
type Versions = Readonly<Record<string, Readonly<Record<string, ComponentType>>>>;

/** Generated versions, from the hero script's committed output, take the place of the hand-written ones they name. */
export function withGenerated(handwritten: Versions, generated: Versions): Versions {
  const merged: Record<string, Readonly<Record<string, ComponentType>>> = { ...handwritten };
  for (const [member, versions] of Object.entries(generated)) merged[member] = { ...merged[member], ...versions };
  return merged;
}

export const MEMBER_VERSIONS: Versions = withGenerated(
  {
    ...PAYMENTS_MEMBERS,
    ...GLOBAL_BANKING_MEMBERS,
    ...MARKETS_MEMBERS,
    ...OPERATIONS_MEMBERS,
    ...GENERIC_MEMBERS,
  },
  GENERATED_MEMBERS,
);

// Each version's element is created once, here, so rendering never creates a component.
const ELEMENTS: Readonly<Record<string, Readonly<Record<string, ReactElement>>>> = Object.fromEntries(
  Object.entries(MEMBER_VERSIONS).map(([member, versions]) => [member, Object.fromEntries(Object.entries(versions).map(([version, component]) => [version, createElement(component)]))]),
);

export function elementFor(member: string, version: string): ReactElement | undefined {
  return ELEMENTS[member]?.[version];
}
