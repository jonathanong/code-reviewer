# feat(ci): fail the build when a workflow step runs with NODE_ENV=development

Adds `scripts/check-workflow-env.mjs`, an opt-in check: it does nothing unless `workflowEnv.files` in `package.json` lists workflow files. For each listed file it fails the build when a step sets `NODE_ENV` to `development`, and when it cannot tell what a step sets.
