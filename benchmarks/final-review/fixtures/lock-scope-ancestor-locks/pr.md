# fix: serialize reply creation with concurrent edits to the thread

Replying to a comment while another request edits or removes that comment (or one above it) could
leave a reply under a thread that changed mid-write. Lock the parent and every ancestor before
inserting the reply so the thread cannot change underneath it.
