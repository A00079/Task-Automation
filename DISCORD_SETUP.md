# Discord Setup Guide

## Steps to Get Discord Webhook URL

### 1. Create/Open Discord Server
- Open Discord
- Create a new server or use existing one
- Create a channel for NAV reports (e.g., #nav-reports)

### 2. Create Webhook
1. Right-click on the channel (#nav-reports)
2. Click "Edit Channel"
3. Go to "Integrations" tab
4. Click "Create Webhook" or "View Webhooks"
5. Click "New Webhook"
6. Name it: "NAV Checker"
7. Click "Copy Webhook URL"

### 3. Update Script
Open `nav-checker.js` and replace line 101:

```javascript
// Change from:
const webhookUrl = 'YOUR_DISCORD_WEBHOOK_URL';

// To:
const webhookUrl = 'https://discord.com/api/webhooks/YOUR_WEBHOOK_URL';
```

### 4. Test
```bash
node nav-checker.js
```

You should see the NAV report in your Discord channel!

## Example Webhook URL Format
```
https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz
```

## That's it!
- Completely FREE
- No restrictions
- Instant delivery
- Works forever
