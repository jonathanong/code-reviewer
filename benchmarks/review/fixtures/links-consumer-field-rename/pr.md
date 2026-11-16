# refactor: camelCase order response and add currency

The order response mixed snake_case with the camelCase used everywhere else in the API. This
renames `total_cents` to `totalCents` and adds the order's `currency`.
