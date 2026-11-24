# refactor(cleanup): remove redundant prelock before sweep

Drop the advisory lock acquisition before running the sweep because the queue already serialises runs.
