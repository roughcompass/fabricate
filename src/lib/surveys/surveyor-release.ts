/**
 * The release of Surveyor the worker runs, which every survey records.
 * @repo-facts/bundle 0.6.0 still exports it under its old name; Surveyor 0.7.0
 * exports it as SURVEYOR_RELEASE, and this module is then its only importer to change.
 */
export { DETECTOR_RELEASE as SURVEYOR_RELEASE } from "@repo-facts/bundle";
