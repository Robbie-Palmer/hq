# Recipe offline data policy

The installed Recipe PWA keeps only the data needed to reopen useful read
views without a network connection.

| Data | Browser storage | Scope | Fresh for | Offline behavior |
| --- | --- | --- | --- | --- |
| Saved recipes and diet options | IndexedDB | User | 24 hours | Read-only |
| Current shopping trip | IndexedDB and local storage | User and personal or household resource | 15 minutes | Readable; checklist changes queue until they sync |
| Active timers | Local storage | User | Derived from absolute end times | Continues counting down |
| Current meal plan | Not stored until meal planning ships | User and household | 15 minutes | The v2 cache contract reserves this scope |

Age never makes a snapshot unreadable. The offline banner shows the age of the
oldest restored IndexedDB snapshot so a cook can judge whether it is still
useful.

IndexedDB schema v2 deletes the old user-only recipe store instead of assigning
its records to a household without evidence. Schema v3 adds a user- and
resource-scoped outbox for checklist changes. Each queued change keeps its
command ID and base revision across reloads, so reconnecting can retry it
without applying it twice. Timer and shopping local-storage records use
user-specific keys; their old unscoped keys are also deleted.

A quota error leaves live network data untouched and shows a storage warning.
The cache does not delete another protected snapshot to make room. Sign-out,
account deletion, or loss of the authenticated session clears IndexedDB,
user-specific local storage, the cached session, and private recipe images.
