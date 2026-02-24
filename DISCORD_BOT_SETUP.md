# Discord Bot Setup Guide

## Step 1: Create Discord Bot

1. **Go to Discord Developer Portal:**
   - Visit: https://discord.com/developers/applications

2. **Create New Application:**
   - Click "New Application"
   - Name: "NAV Checker Bot"
   - Click "Create"

3. **Create Bot:**
   - Go to "Bot" tab (left sidebar)
   - Click "Add Bot"
   - Click "Yes, do it!"

4. **Get Bot Token:**
   - Under "TOKEN" section
   - Click "Reset Token"
   - Click "Copy" (SAVE THIS - you'll need it)
   - Example: `MTQ3NTc1NTQ1Nzg5NjI1NTU5MQ.GxYzAb.1234567890abcdefghijklmnopqrstuvwxyz`

5. **Enable Intents:**
   - Scroll down to "Privileged Gateway Intents"
   - Enable "MESSAGE CONTENT INTENT"
   - Click "Save Changes"

## Step 2: Invite Bot to Your Server

1. **Get Client ID:**
   - Go to "OAuth2" → "General" tab
   - Copy "CLIENT ID"

2. **Generate Invite Link:**
   - Replace YOUR_CLIENT_ID with your actual client ID:
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3072&scope=bot
   ```

3. **Invite Bot:**
   - Open the link in browser
   - Select your server
   - Click "Authorize"
   - Complete captcha

## Step 3: Get Channel ID

1. **Enable Developer Mode:**
   - Discord Settings → Advanced
   - Enable "Developer Mode"

2. **Copy Channel ID:**
   - Right-click on your #nav-reports channel
   - Click "Copy Channel ID"
   - Example: `1234567890123456789`

## Step 4: Update Script

You'll need 3 values:
- **Bot Token:** From Step 1.4
- **Channel ID:** From Step 3.2
- **Webhook URL:** From previous setup

Add to `nav-checker.js`:
```javascript
const DISCORD_BOT_TOKEN = 'YOUR_BOT_TOKEN';
const DISCORD_CHANNEL_ID = 'YOUR_CHANNEL_ID';
const DISCORD_WEBHOOK_URL = 'YOUR_WEBHOOK_URL';
```

## Step 5: Install Discord.js

```bash
npm install discord.js
```

## Summary

You should now have:
- ✅ Bot Token
- ✅ Channel ID  
- ✅ Webhook URL
- ✅ Bot invited to server
- ✅ Bot has "Read Messages" permission

Ready to update the script!
