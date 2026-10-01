# v0.3.0 - Row Query Fix

- Automatically repair duplicate inventory rows when importing or opening a save affected by earlier sphere editing.
- Combine rows for the same player and item ID by adding their quantities together, preserving the total number owned.
- Back up saves before repair and restore uniqueness for inventory queries, including crafting updates.
- Display each sphere copy separately in the editor with its quantity locked at 1.
- Add one sphere copy per click and remove one copy when deleting. Saving other fields preserves the total owned.

Restart the tools after updating, then import or open the affected gme.sqlite to apply the repair. Repair backups are stored in .backups.

Validated with duplicate-row import tests and a user-tested save repair.
