/*
 * The rules a Portal's menu keeps (navigation spec), in a module with no
 * imports so the migrate step and browser forms can use them as well as
 * navigation.ts. portal_menu_items' CHECK constraints hold the same rules.
 */

/** Menus nest at most five levels: a top-level entry is level 1. */
export const MAX_MENU_DEPTH = 5;

/** A leading slash, then lowercase letters, digits, and hyphens in segments separated by single slashes; or the root alone. */
export const MENU_ROUTE = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/;

export const MAX_MENU_LABEL = 100;
