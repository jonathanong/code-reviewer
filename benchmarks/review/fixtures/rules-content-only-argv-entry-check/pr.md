# feat: run the member export from the command line

`node src/members/export.ts out.csv` now writes the export. The module still exports `toCsv` and
`exportMembers` for the admin page, so the command-line part runs only when the file is the entry
point.
