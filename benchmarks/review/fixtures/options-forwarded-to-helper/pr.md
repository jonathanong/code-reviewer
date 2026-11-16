# refactor(references): split the module and resume interrupted imports

- Moves the types, the codec and `nextReference` out of `references.ts` into `types.ts`,
  `codec.ts` and `next.ts`. No behavior change in the moved code.
- Adds `selectResumePoint`, which the statement importer calls after a crash to find the newest
  reference in a year that is still open.
  It takes the codec options, like `nextReference`.
