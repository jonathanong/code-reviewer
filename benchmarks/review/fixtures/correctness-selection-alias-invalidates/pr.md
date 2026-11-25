# perf(ci): run only the tests that read a changed fixture pointer

## Problem

Editing `fixtures/catalog.json` selects every test that read the file, which is most of the
suite, even when the edit touches one plan's price.

## Change

`selectTests` now takes the JSON pointers that changed (`changedPointers` in `src/pointers.mts`)
and keeps a test only when a pointer it reads overlaps one of them.

This is sound because the narrowing only applies when a test's reads are fully known. A test's
source is scanned (`src/trace.mts`) and the proof holds only when every use of `loadFixture` is a call with a literal pointer. A call with a variable pointer, a bare reference, or an alias of the loader voids it. Without the proof the
test stays selected for any change to the file.

## Testing

- Added four cases to `src/select.test.mts`: an unrelated pointer is dropped, an overlapping
  pointer is kept, a variable pointer keeps the test, and an alias or bare reference to the loader keeps it.
- `node --test src/select.test.mts` passes.
