# fix: do not edit deleted comments

Editing a comment that was deleted concurrently silently succeeded. Make the update conditional on
the comment not being deleted and return whether a row changed.
