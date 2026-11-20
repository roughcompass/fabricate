// What the desk starts with, read before anything renders: who's signed in,
// the tab kept for this browser tab, the region cookie, and the desk the
// address asks for.
import { readStartup } from "./startup.js";

window.__quotesDeskStartup = readStartup();

// The shared modules load before the page renders: an asynchronous boundary, as Module Federation needs.
import("./bootstrap.jsx");
