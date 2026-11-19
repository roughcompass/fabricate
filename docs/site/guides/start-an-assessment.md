# Start an Assessment

Choose repositories and Standard Releases, start a Run, and evaluate it to get a Finding for each Control and repository.

## Create the Assessment

1. Open [New Assessment](/assessments/new).
2. Give it a **Name** and an **Objective**.
3. Under **Repository scope**, choose every Repository, or select some. With every Repository, each Run includes the ones registered when it starts.
4. Under **Standard Releases**, select the Releases to evaluate against. Only published Releases appear.
5. Choose **Create Assessment**.

## Start a Run

On the Assessment's page, choose **Start Run**. It pins each scoped repository to the commit its reference names and gets that commit's Profile, reusing a survey that already succeeded. The page shows each repository's progress, and the Run finishes with its Relationship Map once every repository is done. A repository that can't be reached fails alone, with its reason, and the rest go on.

## Evaluate it

Choose **Start Evaluation** on the finished Run. The Evaluation compares the Run's Profiles and Relationship Map with the selected Releases and records a Finding for each Control and subject: Meets, Gap, Indeterminate, or Not applicable. Repositories that failed in the Run are listed as coverage gaps, not as Gaps.

Open a Finding to see what the Control expected, what was observed, the evidence, and, for Indeterminate, every cause that kept it from being decided.

## Again later

A Run never changes its scope or results. To assess the fleet as it is now, start another Run; to judge the same Run against a newer Release, select the Release and evaluate the Run again.
