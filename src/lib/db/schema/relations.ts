import { relations } from "drizzle-orm";
import { runTargets, runs } from "./runs";
import { assessmentTargets, assessments, repositorySources } from "./catalog";
import { evaluationReleases, evaluations, findings } from "./evaluations";
import { relationshipMaps, repositoryProfiles } from "./results";
import { assessmentStandardReleases, standardReleases, standards } from "./standards";
import { surveys } from "./surveys";

export const repositorySourceRelations = relations(repositorySources, ({ one, many }) => ({
  assessmentTargets: many(assessmentTargets),
  runTargets: many(runTargets),
  surveys: many(surveys),
  currentSurvey: one(surveys, { fields: [repositorySources.currentSurveyId], references: [surveys.id] }),
}));

export const assessmentRelations = relations(assessments, ({ many }) => ({
  targets: many(assessmentTargets),
  releaseSelections: many(assessmentStandardReleases),
  runs: many(runs),
  evaluations: many(evaluations),
}));

export const assessmentTargetRelations = relations(assessmentTargets, ({ one }) => ({
  assessment: one(assessments, { fields: [assessmentTargets.assessmentId], references: [assessments.id] }),
  repositorySource: one(repositorySources, { fields: [assessmentTargets.repositorySourceId], references: [repositorySources.id] }),
}));

export const runRelations = relations(runs, ({ one, many }) => ({
  assessment: one(assessments, { fields: [runs.assessmentId], references: [assessments.id] }),
  targets: many(runTargets),
  relationshipMap: one(relationshipMaps),
  evaluations: many(evaluations),
}));

export const runTargetRelations = relations(runTargets, ({ one }) => ({
  run: one(runs, { fields: [runTargets.runId], references: [runs.id] }),
  repositorySource: one(repositorySources, { fields: [runTargets.repositorySourceId], references: [repositorySources.id] }),
  survey: one(surveys, { fields: [runTargets.surveyId], references: [surveys.id] }),
}));

export const surveyRelations = relations(surveys, ({ one, many }) => ({
  repositorySource: one(repositorySources, { fields: [surveys.repositorySourceId], references: [repositorySources.id] }),
  profile: one(repositoryProfiles),
  targets: many(runTargets),
}));

export const standardRelations = relations(standards, ({ many }) => ({
  releases: many(standardReleases),
}));

export const standardReleaseRelations = relations(standardReleases, ({ one, many }) => ({
  standard: one(standards, { fields: [standardReleases.standardId], references: [standards.id] }),
  assessmentSelections: many(assessmentStandardReleases),
}));

export const assessmentStandardReleaseRelations = relations(assessmentStandardReleases, ({ one }) => ({
  assessment: one(assessments, { fields: [assessmentStandardReleases.assessmentId], references: [assessments.id] }),
  release: one(standardReleases, { fields: [assessmentStandardReleases.standardReleaseId], references: [standardReleases.id] }),
}));

export const evaluationRelations = relations(evaluations, ({ one, many }) => ({
  assessment: one(assessments, { fields: [evaluations.assessmentId], references: [assessments.id] }),
  run: one(runs, { fields: [evaluations.runId], references: [runs.id] }),
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
  target: one(runTargets, { fields: [findings.runTargetId], references: [runTargets.id] }),
}));

export const repositoryProfileRelations = relations(repositoryProfiles, ({ one }) => ({
  survey: one(surveys, { fields: [repositoryProfiles.surveyId], references: [surveys.id] }),
}));

export const relationshipMapRelations = relations(relationshipMaps, ({ one }) => ({
  run: one(runs, { fields: [relationshipMaps.runId], references: [runs.id] }),
}));
