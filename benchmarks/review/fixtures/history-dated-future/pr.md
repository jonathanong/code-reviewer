# fix: reject an inverted clamp range

`clamp` silently returned `min` when `min` was greater than `max`. It now throws a RangeError, and
HISTORY records the change.
