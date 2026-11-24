# fix(cleanup): add compare-and-set guard on sweep cursor

Guard against two cleanup runs overlapping by adding a version compare-and-set check when advancing the cursor.
