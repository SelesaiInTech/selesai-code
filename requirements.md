# Requirements: TokenIN account management command

- In `src/extensions/tokenin-onboarding.ts`, add one slash command: `/tokenin <add|switch|remove>`.
- `/tokenin add`: replay the existing TokenIN onboarding/auth flow to add or update an account/key, but do not change the currently active account in `models.json`.
- Store TokenIN accounts in `~/.selesai/agent/tokenin-auth.json`, not `~/.selesai/agent/models.json`.
- `/tokenin switch`: show an interactive picker from saved TokenIN accounts in `tokenin-auth.json`; after selection, update `models.json` from that saved account so it becomes active.
- `/tokenin remove`: show saved accounts, remove the selected account only if it is not currently active; block removal of the active account and tell the user to switch first.
- Scope is slash-command only; no command palette/keybinding command IDs required.
- Success criteria: users can add additional TokenIN keys/accounts, switch active account easily, and remove inactive accounts without breaking active model configuration.
