# fix(export): claim an export with a conditional update before running it

Two workers could pick up the same export and both send it. The worker now claims the export first and stops when another run already holds it.
