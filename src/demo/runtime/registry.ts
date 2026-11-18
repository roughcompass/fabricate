import { type ReactElement, createElement } from "react";
import { GENERATED_MEMBERS } from "./generated";

/**
 * Every microfrontend version the runtime can render, by member and version
 * (design.md, decision 6): each template's committed Salt source. A static
 * map, so a version swap never needs a computed import(). The catalog test
 * checks that it covers every version.
 */
export const MEMBER_VERSIONS = GENERATED_MEMBERS;

// Each version's element is created once, here, so rendering never creates a component.
const ELEMENTS: Readonly<Record<string, Readonly<Record<string, ReactElement>>>> = Object.fromEntries(
  Object.entries(MEMBER_VERSIONS).map(([member, versions]) => [member, Object.fromEntries(Object.entries(versions).map(([version, component]) => [version, createElement(component)]))]),
);

export function elementFor(member: string, version: string): ReactElement | undefined {
  return ELEMENTS[member]?.[version];
}
