# Gmail

Tools for reading, sending, deleting, and organizing Gmail messages on the authenticated user's account. Uses the `gmail.modify` OAuth scope, which covers read, send, label changes, and trash but **not** permanent deletion.

| Tool                  | Description                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `listMessages`        | Lists or searches messages using the full Gmail query syntax (e.g. `is:unread from:foo newer_than:7d`)   |
| `getMessage`          | Fetches a single message with decoded headers, plain-text body, HTML body, and attachment metadata       |
| `sendEmail`           | Sends a plain-text email; supports cc/bcc and threaded replies via `replyToMessageId`                    |
| `trashMessage`        | Moves a message to Trash (reversible from the Gmail UI Trash folder for 30 days). Not a permanent delete |
| `modifyMessageLabels` | Adds and/or removes labels on a message — used for star, archive, mark read, and custom-label tagging    |
| `listLabels`          | Lists all system and user-created Gmail labels with their IDs, for use with the other tools              |

## Common label IDs

System labels you can pass to `modifyMessageLabels` and `listMessages.labelIds` without calling `listLabels` first:

- `INBOX`, `SENT`, `DRAFT`, `TRASH`, `SPAM`
- `UNREAD`, `STARRED`, `IMPORTANT`
- `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`

Custom labels (anything you created in the Gmail UI) have opaque IDs like `Label_1234567890` — fetch them with `listLabels`.
