# NAV Checker Automation

Automated script to check Motilal Oswal Mutual Fund NAV daily and send Discord notifications.

## Setup Discord (2 minutes)

1. **Create Discord Webhook:**
   - Right-click your Discord channel
   - Edit Channel → Integrations → Webhooks
   - Create Webhook → Copy Webhook URL

2. **Update nav-checker.js:**
   - Open `nav-checker.js`
   - Line 101: Replace `YOUR_DISCORD_WEBHOOK_URL` with your webhook URL

3. **Test Locally:**
   ```bash
   npm install
   node nav-checker.js
   ```

## Deploy to Render

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "NAV checker with Discord"
   git remote add origin YOUR_REPO_URL
   git push -u origin main
   ```

2. **Create Cron Job:**
   - Go to: https://dashboard.render.com/cron/new
   - Connect GitHub repository
   - Build Command: `npm install`
   - Start Command: `node nav-checker.js`
   - Schedule: `30 1 * * *` (7 AM IST)
   - Create Cron Job

## How It Works

- Runs daily at 7 AM IST
- Checks if NAV date is updated (yesterday's date, or Friday if Monday)
- Sends Discord message with status
- Completely FREE

## Cost

**FREE** - Render free tier + Discord webhooks
