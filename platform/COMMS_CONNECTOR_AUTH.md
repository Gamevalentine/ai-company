# COMMS-TB-01 External Connector Authorization

Status: connector code is ready; external account authorization is still required.

## Security rule

Never paste access tokens, refresh tokens, client secrets, or bot tokens into chat, source code, issues, logs, or screenshots.
Store them only as encrypted GitHub Actions repository secrets in Gamevalentine/ai-company.

## Gmail — trainingbot.ai2@gmail.com

Recommended scope:
- https://www.googleapis.com/auth/gmail.modify

This scope is sufficient for COMMS to read messages, label them, compose, and send replies.

Required repository secrets:
- GMAIL_CLIENT_ID
- GMAIL_CLIENT_SECRET
- GMAIL_REFRESH_TOKEN

Fixed sender identity:
- trainingbot.ai2@gmail.com

After authorization, run:
- TrainingBot COMMS Connector Status
- then a connector smoke test before enabling automatic inbound processing.

## Facebook Page / Messenger

COMMS supports:
- reply to a Page comment in the same comment thread
- reply to a user who messaged the Page in Messenger

Required repository secrets:
- META_PAGE_ID
- META_PAGE_ACCESS_TOKEN

The Meta app/Page connection must grant the permissions required by the current Messenger/Page APIs. The token must never be committed to source.

A public HTTPS webhook receiver is still required for real-time inbound Messenger/comment events. Do not enable production webhook routing until Owner approval.

## Discord community

COMMS supports sending a reply into the same Discord channel.

Required repository secrets:
- DISCORD_BOT_TOKEN
- DISCORD_GUILD_ID

The bot must be added to the TrainingBot community server with only the permissions it needs to view/read the intended support channels and send replies.

If COMMS is expected to read ordinary message text without a mention/interaction, Message Content access must be enabled as required by Discord.

A persistent inbound listener or an approved polling strategy is still required before Discord can be considered fully operational.

## Operational promotion gate

COMMS-TB-01 may be promoted from CONNECTOR_CODE_READY to OPERATIONAL only when:
1. Gmail authorization passes a live read/label/send-to-test-address smoke test.
2. Facebook Page/Messenger authorization passes an inbound + same-thread reply smoke test.
3. Discord bot authorization passes an inbound + same-channel reply smoke test.
4. No secret appears in logs or artifacts.
5. Sensitive-message escalation remains locked to TB-01.
6. No bulk messaging or paid action is enabled.
