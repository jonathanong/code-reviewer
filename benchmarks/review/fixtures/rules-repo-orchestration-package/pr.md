# feat(reviews): add a hook-injected review engine

Adds `@acme/reviews`. `createReviewsEngine` runs review submission (rating check, target lock,
eligibility, duplicate check, moderation hold for low ratings, owner notification) on hooks the
application provides, so each application only writes its persistence and permission hooks.
