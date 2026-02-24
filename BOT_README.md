# NAV Checker - Discord Bot

Run checks on-demand by messaging in Discord!

## How to Use

1. **Start the bot:**
   ```bash
   node bot.js
   ```

2. **Keep it running** (bot stays online waiting for commands)

3. **Trigger checks from Discord:**
   - Go to your Discord channel
   - Type: `Jarvis wake up`
   - Bot will run NAV and Login checks
   - You'll get "Waiting for OTP" message
   - Reply with OTP
   - Get final report

## Deploy to Render

For 24/7 bot:

1. **Push to GitHub**
2. **Create Web Service** (not Cron Job):
   - Build: `npm install`
   - Start: `node bot.js`
3. Bot stays online forever

## Commands

- `Jarvis wake up` - Runs NAV and Login verification

## Cost

**FREE** - Render free tier keeps bot running 24/7
