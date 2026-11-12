# feat: purge expired sessions every 15 minutes

Adds a scheduled job that deletes expired sessions in batches of 1000 with `SKIP LOCKED`, so
each statement stays short and competing runs never block each other. It keeps going until a
batch comes back short.
