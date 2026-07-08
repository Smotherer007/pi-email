# pi-email-client

IMAP/SMTP email client extension for the [pi coding agent](https://github.com/earendil-works/pi).

Read, search, send, move, and delete emails directly from your pi session. Credentials are stored locally in `~/.pi/email-config.json`.

## Installation

```bash
# Install from npm (once published)
pi install npm:@patimweb/pi-email

# Install from local path during development
pi install /path/to/pi-email-client
```

## Quick Start

1. Configure your email account using the `email_setup` tool
2. Fetch recent inbox emails with `email_fetch`
3. Read full email bodies with `email_read`
4. Send emails with `email_send`
5. Reply to emails with `email_reply` (auto-threading)
6. Forward emails with `email_forward`
7. Mark emails as read/unread/flagged with `email_flag`

Example configuration for Gmail (requires an [app-specific password](https://support.google.com/accounts/answer/185833)):

```
email_setup:
  imapHost: imap.gmail.com
  imapPort: 993
  imapTls: true
  imapUser: you@gmail.com
  imapPassword: <app-password>
  smtpHost: smtp.gmail.com
  smtpPort: 587
  smtpSecure: false
  smtpUser: you@gmail.com
  smtpPassword: <app-password>
  fromName: Your Name
```

For the ProtonMail Bridge, which runs locally on your machine, you can use the following prompt:
```
Use the email_setup tool to configure a an email account with the following details:
 - name: "YOUR_PROFILE_NAME"                                                                                                                             
 - fromName: "YOUR_NAME"                                                                                                                     
 - imapUser: "YOUR_EMAIL"                                                                                                            
 - imapPassword: "YOUR_PASSWORD"                                                                                    
 - imapHost: "127.0.0.1"                                                                                                               
 - imapPort: 1143                                                                                                                           
 - imapTls: false                                                                                                                          
 - smtpUser: "YOUR_EMAIL"                                                                                                            
 - smtpPassword: "YOUR_PASSWORD"                                                                                    
 - smtpHost: "127.0.0.1"                                                                                                               
 - smtpPort: 1025                                                                                                                    
 - smtpSecure: false                                                                                                                         
 - smtpRejectUnauthorized: false
```     

## Tools

| Tool | Description |
|------|-------------|
| `email_setup` | Configure IMAP/SMTP credentials. Must be called first. |
| `email_status` | Show current connection status and configured account. |
| `email_list_mailboxes` | List all available IMAP folders. |
| `email_fetch` | Fetch email headers from a mailbox (from, subject, date, flags). |
| `email_read` | Read the full body of a specific email by UID. Can save attachments. |
| `email_search` | Search emails with IMAP criteria (from, subject, body, date range, unseen). |
| `email_send` | Send an email via SMTP (plain text, HTML, CC, BCC, local file attachments). |
| `email_reply` | Reply to an email. Auto-sets In-Reply-To/References headers for threading. Supports reply-all and quoting. |
| `email_forward` | Forward an email to new recipients with inline forwarding headers. |
| `email_flag` | Set or remove IMAP flags (Seen/Unseen, Flagged, Answered, etc.). |
| `email_delete` | Delete an email by UID. |
| `email_move` | Move an email to another mailbox. |

### Replying to emails

`email_reply` answers an email by UID and automatically sets threading headers so your reply appears in the correct conversation thread. By default, it quotes the original message.

```yaml
email_reply:
  uid: 42
  body: "Thanks, got it!"
  # quoteOriginal: false   # disable quoting
  # replyAll: true          # include all original recipients
```

### Forwarding emails

`email_forward` sends a copy of an email to new recipients with forwarding headers inline in the body. Original attachment names are listed. To re-attach files, first use `email_read` with `downloadDir`, then `email_send` with `attachmentPaths`.

```yaml
email_forward:
  uid: 42
  to: colleague@example.com
  body: "FYI, see below."
  # cc: manager@example.com
```

### Managing flags

`email_flag` sets or removes IMAP flags on an email. Supports friendly aliases like `read`, `starred`, `replied`.

```yaml
# Mark as read
email_flag:
  uid: 42
  add: ["Seen"]

# Mark as unread and starred
email_flag:
  uid: 42
  add: ["Flagged"]
  remove: ["Seen"]
```

Supported flag aliases: `Seen` / `read` / `unread`, `Flagged` / `starred`, `Answered` / `replied`, `Draft`, `Deleted`.

### Sending attachments

`email_send` accepts `attachmentPaths`, an array of local filesystem paths. Absolute paths are safest. URLs and data URIs are not supported.

```yaml
email_send:
  to: recipient@example.com
  subject: Report
  body: Attached.
  attachmentPaths:
    - /path/to/report.pdf
```

## Commands

| Command | Description |
|---------|-------------|
| `/inbox` | Trigger the agent to fetch recent inbox emails. |

## Configuration

Credentials are persisted to `~/.pi/email-config.json`. The `email_setup` tool writes this file automatically. You can also create it manually:

```json
{
  "imap": {
    "host": "imap.gmail.com",
    "port": 993,
    "tls": true,
    "user": "you@gmail.com",
    "password": "<app-password>"
  },
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "secure": false,
    "user": "you@gmail.com",
    "password": "<app-password>"
  },
  "fromName": "Your Name"
}
```

## Architecture

The extension follows data-oriented programming principles:

- **`src/types.ts`** -- All domain data types as plain immutable interfaces. No behavior, no classes, no inheritance.
- **`src/config.ts`** -- Configuration state management and file persistence.
- **`src/clients/imap-client.ts`** -- IMAP operations. Each function opens a connection, performs work, and closes. Returns plain data.
- **`src/clients/smtp-client.ts`** -- SMTP send operations via nodemailer.
- **`src/formatting/formatters.ts`** -- Pure transformation functions that convert domain data into display strings. No side effects.
- **`src/tools/email-setup.ts`** -- Account configuration (IMAP/SMTP credentials).
- **`src/tools/email-status.ts`** -- Show configured profiles.
- **`src/tools/email-list-mailboxes.ts`** -- List IMAP folders.
- **`src/tools/email-fetch.ts`** -- Fetch email headers.
- **`src/tools/email-read.ts`** -- Read full email body with PDF extraction.
- **`src/tools/email-search.ts`** -- Search emails with IMAP criteria.
- **`src/tools/email-send.ts`** -- Send emails via SMTP.
- **`src/tools/email-reply.ts`** -- Reply with threading headers and quoting.
- **`src/tools/email-forward.ts`** -- Forward emails inline.
- **`src/tools/email-flag.ts`** -- Set/remove IMAP flags.
- **`src/tools/email-delete.ts`** -- Delete emails.
- **`src/tools/email-move.ts`** -- Move emails between folders.
- **`src/pdf-reader.ts`** -- PDF text extraction via pdftotext.
- **`index.ts`** -- Extension entry point. Loads config, registers all 12 tools, and registers the `/inbox` command.

## Requirements

- Node.js 18+
- pi coding agent (latest)
- IMAP and SMTP access to your email provider

## Supported Providers

Any email provider with standard IMAP/SMTP access works. Tested configurations:

| Provider | IMAP Host | IMAP Port | SMTP Host | SMTP Port |
|----------|-----------|-----------|-----------|-----------|
| Gmail | imap.gmail.com | 993 | smtp.gmail.com | 587 |
| Outlook/Hotmail | outlook.office365.com | 993 | smtp-mail.outlook.com | 587 |
| Yahoo | imap.mail.yahoo.com | 993 | smtp.mail.yahoo.com | 587 |
| iCloud | imap.mail.me.com | 993 | smtp.mail.me.com | 587 |

Note: Gmail and many providers require app-specific passwords when 2FA is enabled.

## Publishing as a pi Package

To publish this extension to the [pi package catalog](https://pi.dev/packages):

1. Ensure `package.json` has `"keywords": ["pi-package"]`
2. Ensure `package.json` has a `"pi"` section declaring extensions
3. Optionally add `"image"` or `"video"` preview URLs to the `"pi"` manifest
4. Publish to npm: `npm publish`
5. Users install with: `pi install npm:@patimweb/pi-email`

The package catalog auto-discovers packages with the `pi-package` keyword from npm.

## Dependencies

- [imap](https://www.npmjs.com/package/imap) -- IMAP client
- [mailparser](https://www.npmjs.com/package/mailparser) -- Email parsing (RFC 2822, MIME)
- [nodemailer](https://www.npmjs.com/package/nodemailer) -- SMTP client

## License

MIT
