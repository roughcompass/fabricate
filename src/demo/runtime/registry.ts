import { type ComponentType, type ReactElement, createElement } from "react";
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
export const MEMBER_VERSIONS: Readonly<Record<string, Readonly<Record<string, ComponentType>>>> = {
  ...PAYMENTS_MEMBERS,
  ...GLOBAL_BANKING_MEMBERS,
  ...MARKETS_MEMBERS,
  ...OPERATIONS_MEMBERS,
  ...GENERIC_MEMBERS,
};

// Each version's element is created once, here, so rendering never creates a component.
const ELEMENTS: Readonly<Record<string, Readonly<Record<string, ReactElement>>>> = Object.fromEntries(
  Object.entries(MEMBER_VERSIONS).map(([member, versions]) => [member, Object.fromEntries(Object.entries(versions).map(([version, component]) => [version, createElement(component)]))]),
);

export function elementFor(member: string, version: string): ReactElement | undefined {
  return ELEMENTS[member]?.[version];
}
