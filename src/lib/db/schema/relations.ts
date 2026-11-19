import { relations } from "drizzle-orm";
import { assessmentTargets, assessments, sourceSnapshots } from "./assessments";
import { initiativeTargets, initiatives, repositorySources } from "./catalog";
import { evaluationReleases, evaluations, findings } from "./evaluations";
import { relationshipMaps, repositoryProfiles } from "./results";
import { initiativeStandardReleases, standardReleases, standards } from "./standards";

export const repositorySourceRelations = relations(repositorySources, ({ many }) => ({
  initiativeTargets: many(initiativeTargets),
  assessmentTargets: many(assessmentTargets),
}));

export const initiativeRelations = relations(initiatives, ({ many }) => ({
  targets: many(initiativeTargets),
  releaseSelections: many(initiativeStandardReleases),
  assessments: many(assessments),
  evaluations: many(evaluations),
}));

export const initiativeTargetRelations = relations(initiativeTargets, ({ one }) => ({
  initiative: one(initiatives, { fields: [initiativeTargets.initiativeId], references: [initiatives.id] }),
  repositorySource: one(repositorySources, { fields: [initiativeTargets.repositorySourceId], references: [repositorySources.id] }),
}));

export const assessmentRelations = relations(assessments, ({ one, many }) => ({
  initiative: one(initiatives, { fields: [assessments.initiativeId], references: [initiatives.id] }),
  targets: many(assessmentTargets),
  profiles: many(repositoryProfiles),
  relationshipMap: one(relationshipMaps),
  evaluations: many(evaluations),
}));

export const assessmentTargetRelations = relations(assessmentTargets, ({ one }) => ({
  assessment: one(assessments, { fields: [assessmentTargets.assessmentId], references: [assessments.id] }),
  repositorySource: one(repositorySources, { fields: [assessmentTargets.repositorySourceId], references: [repositorySources.id] }),
  snapshot: one(sourceSnapshots),
  profile: one(repositoryProfiles),
}));

export const sourceSnapshotRelations = relations(sourceSnapshots, ({ one }) => ({
  target: one(assessmentTargets, { fields: [sourceSnapshots.assessmentTargetId], references: [assessmentTargets.id] }),
  repositorySource: one(repositorySources, { fields: [sourceSnapshots.repositorySourceId], references: [repositorySources.id] }),
}));

export const standardRelations = relations(standards, ({ many }) => ({
  releases: many(standardReleases),
}));

export const standardReleaseRelations = relations(standardReleases, ({ one, many }) => ({
  standard: one(standards, { fields: [standardReleases.standardId], references: [standards.id] }),
  initiativeSelections: many(initiativeStandardReleases),
}));

export const initiativeStandardReleaseRelations = relations(initiativeStandardReleases, ({ one }) => ({
  initiative: one(initiatives, { fields: [initiativeStandardReleases.initiativeId], references: [initiatives.id] }),
  release: one(standardReleases, { fields: [initiativeStandardReleases.standardReleaseId], references: [standardReleases.id] }),
}));

export const evaluationRelations = relations(evaluations, ({ one, many }) => ({
  initiative: one(initiatives, { fields: [evaluations.initiativeId], references: [initiatives.id] }),
  assessment: one(assessments, { fields: [evaluations.assessmentId], references: [assessments.id] }),
  releases: many(evaluationReleases),
  findings: many(findings),
}));

export const evaluationReleaseRelations = relations(evaluationReleases, ({ one, many }) => ({
  evaluation: one(evaluations, { fields: [evaluationReleases.evaluationId], references: [evaluations.id] }),
  release: one(standardReleases, { fields: [evaluationReleases.standardReleaseId], references: [standardReleases.id] }),
  findings: many(findings),
}));

export const findingRelations = relations(findings, ({ one }) => ({
  evaluation: one(evaluations, { fields: [findings.evaluationId], references: [evaluations.id] }),
  evaluationRelease: one(evaluationReleases, { fields: [findings.evaluationReleaseId], references: [evaluationReleases.id] }),
  release: one(standardReleases, { fields: [findings.standardReleaseId], references: [standardReleases.id] }),
  target: one(assessmentTargets, { fields: [findings.assessmentTargetId], references: [assessmentTargets.id] }),
}));

export const repositoryProfileRelations = relations(repositoryProfiles, ({ one }) => ({
  assessment: one(assessments, { fields: [repositoryProfiles.assessmentId], references: [assessments.id] }),
  target: one(assessmentTargets, { fields: [repositoryProfiles.assessmentTargetId], references: [assessmentTargets.id] }),
  snapshot: one(sourceSnapshots, { fields: [repositoryProfiles.sourceSnapshotId], references: [sourceSnapshots.id] }),
}));

export const relationshipMapRelations = relations(relationshipMaps, ({ one }) => ({
  assessment: one(assessments, { fields: [relationshipMaps.assessmentId], references: [assessments.id] }),
}));
