// ============================================================
// checker.js  VERSION: v4-react-fix  (2026-02-25)
// ============================================================
const puppeteer = require('puppeteer');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Discord Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Login Configuration
const PAN_NUMBER = process.env.PAN_NUMBER;
const PASSCODE = process.env.PASSCODE;

// PMS Admin Configuration
const PMS_USERNAME = '16340';
const PMS_PASSWORD = 'Mosl@2026';
const PMS_PAN = 'AINPB3346D';

// Feature Flags
const SKIP_LOGIN_CHECK = false; // Set to false to enable login check
const SKIP_PMS_DASHBOARD_CHECK = false; // Set to false to enable PMS dashboard check
const SKIP_MF_ACCOUNT_STATEMENT_CHECK = false; // Set to false to enable MF account statement check
const BETA_VERIFICATION_LIMIT = 5; // Set to 0 for all funds, or a number like 5 to test only 5 funds

// Stealth Helper: Random delay between min and max milliseconds
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Stealth Helper: Human-like wait
async function humanWait(minMs = 1000, maxMs = 3000) {
  await new Promise(resolve => setTimeout(resolve, randomDelay(minMs, maxMs)));
}

// Function to get expected NAV date (yesterday or Friday if today is Monday)
function getExpectedNAVDate() {
  // Get current date in IST (UTC+5:30)
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istTime = new Date(now.getTime() + istOffset);
  
  const dayOfWeek = istTime.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  
  let daysToSubtract = 1;
  if (dayOfWeek === 1) { // Monday
    daysToSubtract = 3; // Go back to Friday
  } else if (dayOfWeek === 0) { // Sunday (shouldn't run, but handle it)
    daysToSubtract = 2; // Go back to Friday
  }
  
  const expectedDate = new Date(istTime);
  expectedDate.setUTCDate(istTime.getUTCDate() - daysToSubtract);
  
  console.log(`IST Date: ${istTime.toISOString()}, Day: ${dayOfWeek}`);
  
  return expectedDate;
}

// Function to format date as DD-MMM-YYYY (e.g., 23-Feb-2026)
function formatDate(date) {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  
  return `${day}-${month}-${year}`;
}

// Function to check all funds loading properly
async function checkAllFundsLoading(page) {
  try {
    console.log('Navigating to NAV page for funds check...');
    
    await page.goto('https://www.motilaloswalmf.com/nav/latest-nav', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    await page.waitForSelector('.table_nav tbody tr', { timeout: 10000 });
    
    const fundsData = {};
    let currentPage = 1;
    
    while (true) {
      console.log(`Scraping page ${currentPage}...`);
      
      // Extract Direct - Growth funds from current page
      const pageData = await page.evaluate(() => {
        const rows = document.querySelectorAll('.table_nav tbody tr');
        const data = {};
        
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            const schemeName = cells[1].textContent.trim();
            const nav = cells[3].textContent.trim();
            
            if (schemeName.includes('- Direct - Growth')) {
              data[schemeName] = nav;
            }
          }
        });
        
        return data;
      });
      
      Object.assign(fundsData, pageData);
      console.log(`Found ${Object.keys(pageData).length} Direct - Growth funds on page ${currentPage}`);
      
      // Check if there's a next page
      const hasNextPage = await page.evaluate(() => {
        const nextBtn = document.querySelector('.pagination .page-item:last-child a');
        if (!nextBtn) return false;
        const isDisabled = nextBtn.closest('.page-item').classList.contains('disabled');
        return !isDisabled;
      });
      
      if (!hasNextPage) {
        console.log('No more pages to scrape');
        break;
      }
      
      // Click next page
      await page.evaluate(() => {
        const nextBtn = document.querySelector('.pagination .page-item:last-child a');
        if (nextBtn) nextBtn.click();
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.waitForSelector('.table_nav tbody tr', { timeout: 10000 });
      currentPage++;
    }
    
    console.log(`Total Direct - Growth funds found: ${Object.keys(fundsData).length}`);
    
    // Save to JSON file
    const filePath = path.join(__dirname, '..', 'funds-nav-data.json');
    fs.writeFileSync(filePath, JSON.stringify(fundsData, null, 2));
    console.log(`Funds data saved to: ${filePath}`);
    
    return {
      success: true,
      fundsData,
      totalFunds: Object.keys(fundsData).length,
      filePath
    };
    
  } catch (error) {
    console.error('Error checking all funds:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to compare NAV values with smart matching
// Allows minor decimal differences but rejects major value changes
function compareNAV(expected, actual) {
  if (!expected || !actual) return false;
  
  const exp = parseFloat(expected);
  const act = parseFloat(actual);
  
  if (isNaN(exp) || isNaN(act)) return false;
  
  // Check if integer parts match (before decimal point)
  const expInt = Math.floor(exp);
  const actInt = Math.floor(act);
  
  if (expInt !== actInt) {
    // Integer parts don't match - this is a major difference
    return false;
  }
  
  // Integer parts match, check decimal difference
  // Allow up to 0.1 difference in decimal part
  const diff = Math.abs(exp - act);
  return diff <= 0.1;
}

// Function to verify funds on beta website
async function verifyFundsOnBeta(browser, fundsData) {
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('\n========== BETA WEBSITE VERIFICATION FLOW ==========');
    console.log('Navigating to beta website...');
    await page.goto('https://beta.motilaloswalmf.com/mutual-funds', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    console.log('✓ Beta website loaded successfully');
    
    const matched = [];
    const notMatched = [];
    const notFound = [];
    
    const fundsArray = Object.entries(fundsData);
    const limit = BETA_VERIFICATION_LIMIT > 0 ? BETA_VERIFICATION_LIMIT : fundsArray.length;
    const fundsToCheck = fundsArray.slice(0, limit);
    
    console.log(`\nTotal funds in JSON: ${fundsArray.length}`);
    console.log(`Funds to verify: ${fundsToCheck.length} (Limit: ${BETA_VERIFICATION_LIMIT === 0 ? 'ALL' : BETA_VERIFICATION_LIMIT})\n`);
    
    for (let i = 0; i < fundsToCheck.length; i++) {
      const [fullName, expectedNav] = fundsToCheck[i];
      const fundName = fullName.replace(' - Direct - Growth', '');
      
      console.log(`\n[${i + 1}/${fundsToCheck.length}] ========================================`);
      console.log(`Fund: ${fundName}`);
      console.log(`Expected NAV: ${expectedNav}`);
      
      try {
        // Enter fund name in search
        console.log('Step 1: Entering fund name in search field...');
        await page.waitForSelector('#search-field', { timeout: 5000 });
        await page.click('#search-field');
        await page.evaluate(() => document.querySelector('#search-field').value = '');
        await page.type('#search-field', fundName);
        await new Promise(resolve => setTimeout(resolve, 1500));
        console.log('✓ Search field populated');
        
        // Click on the search result
        console.log('Step 2: Clicking on search result...');
        const clicked = await page.evaluate((name) => {
          const items = document.querySelectorAll('.list-search .list-fund-name');
          for (const item of items) {
            if (item.style.display !== 'none' && item.textContent.includes(name)) {
              const link = item.querySelector('a');
              if (link) {
                link.click();
                return true;
              }
            }
          }
          return false;
        }, fundName);
        
        if (!clicked) {
          console.log('✗ Fund not found in search results');
          notFound.push({ fund: fullName, reason: 'Not found in search' });
          continue;
        }
        console.log('✓ Search result clicked');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Click Know More button
        console.log('Step 3: Clicking Know More button...');
        await page.waitForSelector('.know-more.card-btn', { timeout: 5000 });
        
        const currentUrl = page.url();
        console.log(`Current URL before click: ${currentUrl}`);
        
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
          page.click('.know-more.card-btn')
        ]);
        
        const redirectedUrl = page.url();
        console.log(`✓ Redirected to: ${redirectedUrl}`);
        
        // Get NAV value
        console.log('Step 4: Extracting NAV value from page...');
        await page.waitForSelector('.value-nav', { timeout: 5000 });
        const actualNav = await page.evaluate(() => {
          const navEl = document.querySelector('.value-nav');
          return navEl ? navEl.textContent.trim() : null;
        });
        
        console.log(`Actual NAV found: ${actualNav}`);
        
        // Compare NAVs with smart matching
        const isMatch = compareNAV(expectedNav, actualNav);
        
        if (isMatch) {
          console.log(`✓ NAV MATCHED: ${expectedNav} ≈ ${actualNav}`);
          matched.push({ fund: fullName, nav: expectedNav, actualNav });
        } else {
          console.log(`✗ NAV MISMATCH: Expected ${expectedNav}, Got ${actualNav}`);
          notMatched.push({ fund: fullName, expected: expectedNav, actual: actualNav });
        }
        
        // Go back to funds page
        console.log('Step 5: Navigating back to funds page...');
        await page.goto('https://beta.motilaloswalmf.com/mutual-funds', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('✓ Back to funds page');
        
      } catch (error) {
        console.error(`✗ Error: ${error.message}`);
        notFound.push({ fund: fullName, reason: error.message });
        
        // Try to go back to funds page
        await page.goto('https://beta.motilaloswalmf.com/mutual-funds', {
          waitUntil: 'networkidle2',
          timeout: 30000
        }).catch(() => {});
      }
    }
    
    console.log('\n========== VERIFICATION SUMMARY ==========');
    console.log(`Total Checked: ${fundsToCheck.length}`);
    console.log(`Matched: ${matched.length}`);
    console.log(`Not Matched: ${notMatched.length}`);
    console.log(`Not Found: ${notFound.length}`);
    console.log('==========================================\n');
    
    await page.close();
    
    return {
      success: true,
      matched,
      notMatched,
      notFound,
      total: fundsToCheck.length,
      totalInJson: fundsArray.length
    };
    
  } catch (error) {
    console.error('Error verifying funds on beta:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Function to check NAV update with existing page
async function checkNAVWithPage(page) {
  try {
    console.log('Navigating to NAV page...');
    
    await page.goto('https://www.motilaloswalmf.com/nav/latest-nav', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    await page.waitForSelector('.table_nav tbody tr', { timeout: 10000 });
    
    const firstRowDate = await page.evaluate(() => {
      const firstRow = document.querySelector('.table_nav tbody tr td:first-child');
      return firstRow ? firstRow.textContent.trim() : null;
    });
    
    console.log(`First row date found: ${firstRowDate}`);
    
    const expectedDate = getExpectedNAVDate();
    const expectedDateStr = formatDate(expectedDate);
    
    console.log(`Expected date: ${expectedDateStr}`);
    console.log(`Actual date: ${firstRowDate}`);
    
    const isUpdated = firstRowDate === expectedDateStr;
    
    return {
      success: true,
      isUpdated,
      expectedDate: expectedDateStr,
      actualDate: firstRowDate
    };
    
  } catch (error) {
    console.error('Error checking NAV:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Function to check NAV update
async function checkNAVUpdate() {
  let browser;
  
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    
    const page = await browser.newPage();
    const result = await checkNAVWithPage(page);
    await page.close();
    
    return result;
    
  } catch (error) {
    console.error('Error checking NAV:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Function to send Discord message
async function sendDiscordMessage(message) {
  console.log('Discord Message to send:');
  console.log(message);
  
  try {
    // Discord has a 2000 character limit, split if needed
    const MAX_LENGTH = 2000;
    
    if (message.length <= MAX_LENGTH) {
      await axios.post(DISCORD_WEBHOOK_URL, { content: message });
      console.log('✅ Discord message sent successfully!');
    } else {
      // Split message into chunks
      const parts = [];
      let currentPart = '';
      const lines = message.split('\n');
      
      for (const line of lines) {
        if ((currentPart + line + '\n').length > MAX_LENGTH) {
          if (currentPart) parts.push(currentPart);
          currentPart = line + '\n';
        } else {
          currentPart += line + '\n';
        }
      }
      if (currentPart) parts.push(currentPart);
      
      // Send each part
      for (let i = 0; i < parts.length; i++) {
        await axios.post(DISCORD_WEBHOOK_URL, { content: parts[i] });
        console.log(`✅ Discord message part ${i + 1}/${parts.length} sent successfully!`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between messages
      }
    }
  } catch (error) {
    console.error('❌ Failed to send Discord message:', error.response?.data || error.message);
  }
}

// Function to wait for OTP from Discord
async function waitForOTP(existingClient) {
  return new Promise((resolve, reject) => {
    const messageHandler = (msg) => {
      if (msg.channelId === DISCORD_CHANNEL_ID && !msg.author.bot) {
        const otp = msg.content.trim();
        if (/^\d{6}$/.test(otp)) {
          console.log(`OTP received: ${otp}`);
          clearTimeout(timeout);
          existingClient.removeListener('messageCreate', messageHandler);
          resolve(otp);
        }
      }
    };

    const timeout = setTimeout(() => {
      existingClient.removeListener('messageCreate', messageHandler);
      reject(new Error('OTP timeout - no response received within 2 minutes'));
    }, 120000);

    console.log('Setting up OTP listener...');
    existingClient.on('messageCreate', messageHandler);
  });
}

// Function to wait for KFintech values from Discord
async function waitForKFintechValues(existingClient) {
  return new Promise((resolve, reject) => {
    const messageHandler = (msg) => {
      if (msg.channelId === DISCORD_CHANNEL_ID && !msg.author.bot) {
        const content = msg.content.trim();
        // Expected format: "1234.56 7890.12" or "1234.56,7890.12"
        const match = content.match(/^([\d,]+\.?\d*)\s*[,\s]\s*([\d,]+\.?\d*)$/);
        if (match) {
          const aum = parseFloat(match[1].replace(/,/g, ''));
          const costValue = parseFloat(match[2].replace(/,/g, ''));
          if (!isNaN(aum) && !isNaN(costValue)) {
            console.log(`KFintech values received - AUM: ${aum}, Cost: ${costValue}`);
            clearTimeout(timeout);
            existingClient.removeListener('messageCreate', messageHandler);
            resolve({ aum, costValue });
          }
        }
      }
    };

    const timeout = setTimeout(() => {
      existingClient.removeListener('messageCreate', messageHandler);
      reject(new Error('KFintech values timeout - no response received within 2 minutes'));
    }, 120000);

    console.log('Setting up KFintech values listener...');
    existingClient.on('messageCreate', messageHandler);
  });
}

// Function to check login
async function checkLogin(browser, discordClient, panNumber, passcode) {
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    // ── STEP 1: Enter PAN and click Authenticate ─────────────────────────────
    console.log('Navigating to beta login page...');
    await page.goto('https://beta.motilaloswalmf.com/login-page', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForSelector('#login-pan-input', { timeout: 10000 });
    await humanWait(500, 1000);
    await page.click('#login-pan-input');
    await page.type('#login-pan-input', panNumber);
    console.log(`PAN entered: ${panNumber}`);

    await humanWait(800, 1500);

    // Wait for Authenticate button to become enabled (removes is-disabled class)
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('p.auth.btn');
        return btn && !btn.classList.contains('is-disabled');
      },
      { timeout: 10000 }
    );

    console.log('Clicking Authenticate button...');
    await page.evaluate(() => {
      const btn = document.querySelector('p.auth.btn');
      if (btn) btn.click();
    });

    // ── STEP 2: Wait for OTP inputs and enter OTP ────────────────────────────
    console.log('Waiting for OTP inputs...');
    await page.waitForSelector('.otp-input', { timeout: 20000 });
    console.log('OTP inputs appeared');

    await sendDiscordMessage('⏳ **Waiting for OTP**\n\nPlease reply with the 6-digit OTP you received.');
    const otp = await waitForOTP(discordClient);
    console.log(`Got OTP: ${otp}, entering...`);

    await humanWait(500, 1000);
    const otpInputs = await page.$$('.otp-input');
    for (let i = 0; i < otp.length && i < otpInputs.length; i++) {
      await otpInputs[i].click();
      await otpInputs[i].type(otp[i]);
      await new Promise(resolve => setTimeout(resolve, randomDelay(80, 150)));
    }
    console.log('OTP entered');

    await humanWait(500, 1000);

    // Click Submit button (inside .kycblock)
    console.log('Clicking Submit button...');
    await page.evaluate(() => {
      const btn = document.querySelector('.kycblock ~ .btn-descr p.auth.btn, .btn-descr p.auth.btn');
      if (btn) btn.click();
    });

    // ── STEP 3: Wait for passcode inputs and enter passcode ──────────────────
    console.log('Waiting for passcode inputs...');
    await page.waitForSelector('#pass-label1', { timeout: 30000 });
    console.log('Passcode inputs appeared');

    await humanWait(800, 1500);
    const passcodeIds = ['#pass-label1', '#pass-label2', '#pass-label3', '#pass-label4'];
    for (let i = 0; i < passcode.length && i < passcodeIds.length; i++) {
      await page.click(passcodeIds[i]);
      await page.type(passcodeIds[i], passcode[i]);
      await new Promise(resolve => setTimeout(resolve, randomDelay(80, 150)));
    }
    console.log('Passcode entered');

    await humanWait(500, 1000);

    // Click Continue button - find the one with exact 'Continue' text
    console.log('Clicking Continue button...');
    const continueClicked = await page.evaluate(() => {
      const allBtns = document.querySelectorAll('p.auth.btn');
      for (const btn of allBtns) {
        if (btn.textContent.trim() === 'Continue') {
          console.log('Found Continue button, clicking...');
          btn.click();
          return true;
        }
      }
      return false;
    });
    console.log(`Continue button clicked: ${continueClicked}`);
    if (!continueClicked) throw new Error('Continue button not found or text mismatch');

    // ── STEP 4: Wait for cross-domain redirect to invest.motilaloswalmf.com ────────────
    console.log('Waiting for cross-domain redirect to invest dashboard...');

    // Use framenavigated event - waitForFunction breaks on cross-domain navigation
    await new Promise((resolve) => {
      const onNav = (frame) => {
        if (frame === page.mainFrame()) {
          const url = frame.url();
          console.log(`Navigation detected: ${url}`);
          if (!url.includes('login-page')) {
            page.off('framenavigated', onNav);
            resolve();
          }
        }
      };
      page.on('framenavigated', onNav);
      setTimeout(() => { page.off('framenavigated', onNav); resolve(); }, 60000);
    });

    let finalUrl = page.url();
    console.log(`URL after redirect: ${finalUrl}`);

    // Wait for page to fully settle
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 8000))
    ]);

    finalUrl = page.url();
    console.log(`Final settled URL: ${finalUrl}`);

    // Extra buffer for React to render
    await new Promise(resolve => setTimeout(resolve, 4000));

    if (finalUrl.includes('login-page')) {
      throw new Error(`Still on login-page after passcode submit. URL: ${finalUrl}`);
    }

    // Extract username from dashboard
    const dashboardData = await page.evaluate(() => {
      // Check for 'Welcome,' text (no-investment new user dashboard)
      const welcomeEl = document.querySelector('p.css-10y7qtq');
      const nameEl = document.querySelector('p.css-nhob99');
      if (welcomeEl && welcomeEl.textContent.trim() === 'Welcome,') {
        const name = nameEl ? nameEl.textContent.trim() : '';
        return { userName: 'Welcome, ' + name, isNewUser: true };
      }

      // Existing investor dashboard selectors
      for (const sel of ['.user-pan-para', '.css-nhob99', '.zeroBalanceText h3']) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return { userName: el.textContent.trim(), isNewUser: false };
      }
      for (const el of document.querySelectorAll('p, h1, h2, h3, span')) {
        if (el.textContent.trim().startsWith('Welcome')) return { userName: el.textContent.trim(), isNewUser: false };
      }
      return { userName: null, isNewUser: false };
    });

    const { userName, isNewUser } = dashboardData;

    if (isNewUser) {
      console.log(`New user with no investments. URL: ${finalUrl}, User: ${userName}`);
      await page.close();
      return { success: true, userName, portfolioData: { currentValue: null, totalInvestment: null }, isNewUser: true };
    }

    console.log(`Login successful. URL: ${finalUrl}, User: ${userName || 'not found'}`);

    const portfolioData = await page.evaluate(() => {
      let currentValue = null, totalInvestment = null;
      const allP = Array.from(document.querySelectorAll('p'));
      for (const p of allP) {
        const prev = p.previousElementSibling;
        if (!prev) continue;
        const text = p.textContent.replace(/₹|,|\s/g, '');
        if (prev.textContent.includes('Current Value')) currentValue = parseFloat(text);
        if (prev.textContent.includes('Total Investment')) totalInvestment = parseFloat(text);
      }
      return { currentValue, totalInvestment };
    });
    console.log('Portfolio data:', portfolioData);
    await page.close();
    return { success: true, userName: userName || finalUrl, portfolioData };
  } catch (error) {
    console.error('Login check failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Helper: set a value on a React-controlled input or select element.
// Standard page.type() / page.select() only update the DOM value but do NOT
// trigger React's synthetic onChange, so the component state stays stale.
// This helper uses the native prototype setter (which bypasses React's interception)
// then fires 'input' + 'change' events with bubbles:true so React's handler fires.
async function setReactValue(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('Element not found: ' + sel);
    const isSelect = el.tagName === 'SELECT';
    const proto = isSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeSetter.call(el, val);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}

// Function to check MF Account Statement
async function checkMFAccountStatement(browser) {
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    console.log('Navigating to SIP Report page...');
    await page.goto('https://invest.motilaloswalmf.com/reports/sip-report', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Set up listener for new page/tab
    const newPagePromise = new Promise(resolve => {
      browser.once('targetcreated', async target => {
        const newPage = await target.page();
        resolve(newPage);
      });
    });

    // Click Download Report button
    console.log('Looking for Download Report button...');
    const downloadClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        if (btn.textContent.includes('Download Report')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!downloadClicked) {
      throw new Error('Download Report button not found');
    }

    console.log('Download Report button clicked, waiting for report to open...');

    // Wait for new tab with report
    const reportPage = await Promise.race([
      newPagePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Report tab did not open within 15 seconds')), 15000))
    ]);

    await new Promise(resolve => setTimeout(resolve, 3000));
    let reportUrl = reportPage.url();
    console.log('Report opened in new tab:', reportUrl);

    // Wait for dynamic PDF URL if not loaded yet
    if (!reportUrl.includes('MFSIPReport_') && !reportUrl.includes('.pdf')) {
      console.log('Waiting for PDF URL to load...');
      await reportPage.waitForNavigation({ timeout: 10000 }).catch(() => {});
      reportUrl = reportPage.url();
      console.log('PDF URL after navigation:', reportUrl);
    }

    // Verify it's the MF SIP Report PDF
    if (!reportUrl.includes('MFSIPReport_') || !reportUrl.includes('.pdf')) {
      throw new Error('Expected MFSIPReport PDF URL not found');
    }

    console.log('MF Account Statement report generated successfully');
    await reportPage.close();
    await page.close();
    return { 
      success: true, 
      message: 'MF Account Statement report generated successfully',
      reportUrl: reportUrl
    };

  } catch (error) {
    console.error('MF Account Statement check failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Function to check Account Performance Report
async function checkAccountPerformance(browser) {
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    console.log('Navigating to Account Performance page...');
    await page.goto('https://pms.motilaloswalmf.com/v2/pms/reports/accountPerformance', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Click on Select PMS Code field
    console.log('Clicking Select PMS Code field...');
    await page.waitForSelector('div[aria-labelledby="pmsId"]', { timeout: 10000 });
    await page.click('div[aria-labelledby="pmsId"]');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Wait for popup and select first option (PMVP15293)
    console.log('Waiting for PMS Code popup...');
    await page.waitForSelector('li[id="PMVP15293"]', { timeout: 10000 });
    
    // Click the list item to select it
    await page.click('li[id="PMVP15293"]');
    console.log('Clicked PMS Code: PMVP15293');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Verify selection by checking if checkbox is checked
    const isSelected = await page.evaluate(() => {
      const li = document.querySelector('li[id="PMVP15293"]');
      if (li) {
        const checkbox = li.querySelector('input[type="checkbox"]');
        return checkbox ? checkbox.checked : false;
      }
      return false;
    });
    
    console.log('PMS Code checkbox checked:', isSelected);

    if (!isSelected) {
      console.log('First click failed, trying direct checkbox click...');
      await page.evaluate(() => {
        const li = document.querySelector('li[id="PMVP15293"]');
        if (li) {
          const checkbox = li.querySelector('input[type="checkbox"]');
          if (checkbox) checkbox.click();
        }
      });
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Close the popup by clicking outside
    await page.keyboard.press('Escape');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click View button
    console.log('Clicking View button...');
    await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
    await page.click('button[type="submit"]');
    console.log('View button clicked, checking for validation errors...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check for validation errors
    const validationError = await page.evaluate(() => {
      const errorElements = document.querySelectorAll('.Mui-error, [role="alert"], .MuiFormHelperText-root');
      for (const el of errorElements) {
        const text = el.textContent.trim();
        if (text.includes('At least one PMS Code is required') || text.includes('required')) {
          return text;
        }
      }
      return null;
    });

    if (validationError) {
      throw new Error(`Validation error: ${validationError}`);
    }

    console.log('No validation errors, waiting for data to load...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Wait for Download PDF button to appear
    console.log('Waiting for Download PDF button...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Click Download PDF button and wait for new tab
    console.log('Looking for Download PDF button...');
    
    // Set up listener for new page/tab
    const newPagePromise = new Promise(resolve => {
      browser.once('targetcreated', async target => {
        const newPage = await target.page();
        resolve(newPage);
      });
    });

    const downloadClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        if (btn.textContent.includes('Download PDF')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!downloadClicked) {
      throw new Error('Download PDF button not found');
    }

    console.log('Download PDF button clicked, waiting for PDF to open...');

    // Wait for new tab with PDF
    const pdfPage = await Promise.race([
      newPagePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('PDF tab did not open within 15 seconds')), 15000))
    ]);

    // Wait for navigation to PDF URL (it takes time to generate)
    console.log('New tab opened, waiting for PDF URL...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    let pdfUrl = pdfPage.url();
    console.log('Current URL:', pdfUrl);
    
    // If not PDF yet, wait for navigation
    if (!pdfUrl.includes('.pdf')) {
      console.log('Waiting for navigation to PDF...');
      await pdfPage.waitForNavigation({ timeout: 10000 }).catch(() => {});
      pdfUrl = pdfPage.url();
      console.log('PDF URL after navigation:', pdfUrl);
    }

    // Verify it's a PDF URL
    if (!pdfUrl.includes('.pdf')) {
      throw new Error('Opened page is not a PDF');
    }

    // Check if PDF is accessible (status 200)
    const axios = require('axios');
    try {
      const response = await axios.head(pdfUrl, { timeout: 5000 });
      if (response.status === 200) {
        console.log('PDF is accessible and generated successfully');
        await pdfPage.close();
        await page.close();
        return { 
          success: true, 
          message: 'Account Performance report generated successfully',
          pdfUrl: pdfUrl
        };
      } else {
        throw new Error(`PDF returned status ${response.status}`);
      }
    } catch (error) {
      throw new Error(`PDF accessibility check failed: ${error.message}`);
    }

  } catch (error) {
    console.error('Account Performance check failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Function to check PMS dashboard
async function checkPMSDashboard(browser) {
  try {
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
    });

    // ── STEP 1: Admin login ──────────────────────────────────────────────────
    console.log('Navigating to PMS admin login...');
    await page.goto('https://www.motilaloswalmf.com/adminlogin/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await setReactValue(page, 'input[name="username"]', PMS_USERNAME);
    console.log('PMS Username entered');

    await page.waitForSelector('input[name="password"]', { timeout: 10000 });
    await setReactValue(page, 'input[name="password"]', PMS_PASSWORD);
    console.log('PMS Password entered');

    // Login page has only one .login_button (SUBMIT), safe to click directly
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
      page.click('button.login_button')
    ]);
    console.log('Navigated to admin dashboard page');

    // ── STEP 2: Select PMS from dropdown ────────────────────────────────────
    console.log('Waiting for dropdown to appear...');
    
    // Wait longer and check if dropdown exists
    try {
      await page.waitForSelector('select[name="name"]', { timeout: 15000 });
    } catch (e) {
      console.log('Dropdown not found, checking page state...');
      await page.screenshot({ path: '/tmp/pms-no-dropdown.png' });
      
      const pageInfo = await page.evaluate(() => {
        return {
          url: window.location.href,
          hasForm: !!document.querySelector('form'),
          hasSelect: !!document.querySelector('select'),
          bodyText: document.body.innerText.substring(0, 300)
        };
      });
      
      console.log('Page info:', pageInfo);
      throw new Error('Dropdown select[name="name"] not found. Check screenshot at /tmp/pms-no-dropdown.png');
    }
    
    await setReactValue(page, 'select[name="name"]', 'PMS');

    const selectedVal = await page.$eval('select[name="name"]', el => el.value);
    console.log('Dropdown value after set: "' + selectedVal + '"');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // ── STEP 3: Enter PAN number ─────────────────────────────────────────────
    await page.waitForSelector('input[name="panNo"]', { timeout: 10000 });
    await setReactValue(page, 'input[name="panNo"]', PMS_PAN);

    const panVal = await page.$eval('input[name="panNo"]', el => el.value);
    console.log('PAN field value after set: "' + panVal + '"');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // ── STEP 4: Click SUBMIT (not LOG OUT) ───────────────────────────────────
    console.log('Clicking SUBMIT button...');
    
    // Find the SUBMIT button inside the form
    const submitBtn = await page.$('form button.login_button');
    if (!submitBtn) {
      throw new Error('SUBMIT button not found inside <form>');
    }
    
    const btnLabel = await page.evaluate(el => el.textContent.trim(), submitBtn);
    console.log('Button label: "' + btnLabel + '"');

    // Instead of just clicking, we'll also try to submit the form directly
    // as a fallback mechanism
    
    // Method 1: Click the button
    await submitBtn.click();
    console.log('SUBMIT clicked, waiting for navigation...');
    
    // Wait for potential AJAX request
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check if URL changed after click
    let currentUrl = page.url();
    console.log('URL after click: ' + currentUrl);
    
    // Method 2: If still on same page or only URL params changed, try to find and click any redirect trigger
    if (currentUrl.includes('adminlogin/dashboard')) {
      console.log('Still on dashboard page, checking for response...');
      
      // Check if there's any success message or if we need to wait for redirect
      const pageContent = await page.evaluate(() => {
        return {
          hasForm: !!document.querySelector('form'),
          hasSelect: !!document.querySelector('select[name="name"]'),
          hasPanInput: !!document.querySelector('input[name="panNo"]'),
          bodyText: document.body.innerText.substring(0, 200)
        };
      });
      
      console.log('Page content after submit:', pageContent.bodyText);
      
      // Try to find any link/button that might lead to PMS dashboard
      const pmsLink = await page.$('a[href*="pms"]');
      if (pmsLink) {
        console.log('Found PMS link, clicking it...');
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
          pmsLink.click()
        ]);
      } else {
        // Try direct navigation to PMS dashboard
        console.log('Attempting direct navigation to PMS dashboard...');
        await page.goto('https://pms.motilaloswalmf.com/v2/pms/dashboard', {
          waitUntil: 'networkidle2',
          timeout: 30000
        }).catch(e => console.log('Direct navigation failed:', e.message));
      }
    }

    // ── STEP 5: Wait for navigation/redirect ───────────────────────────────
    console.log('Waiting for redirect to PMS domain...');
    
    // Wait for either navigation or URL change
    try {
      await page.waitForFunction(
        () => window.location.href.includes('pms.motilaloswalmf.com'),
        { timeout: 15000 }
      );
    } catch (e) {
      console.log('Navigation timeout, checking current URL...');
    }
    
    currentUrl = page.url();
    console.log('Current URL after navigation: ' + currentUrl);

    // If still not on PMS domain, try one more approach - look for iframe or new window
    if (!currentUrl.includes('pms.motilaloswalmf.com')) {
      console.log('Not on PMS domain yet, checking for iframes...');
      
      // Check if there's an iframe that contains the PMS dashboard
      const frames = page.frames();
      for (const frame of frames) {
        const frameUrl = frame.url();
        if (frameUrl.includes('pms.motilaloswalmf.com')) {
          console.log('Found PMS dashboard in iframe: ' + frameUrl);
          // Switch to that frame to extract welcome message
          await page.close();
          return { success: true, message: 'PMS Dashboard loaded in iframe', userName: 'Unknown (in iframe)' };
        }
      }
      
      // Take screenshot for debugging
      await page.screenshot({ path: '/tmp/pms-stuck.png' });
      
      // Check for any error messages
      const errorMsg = await page.evaluate(() => {
        const errorElements = document.querySelectorAll('.error, .Mui-error, [role="alert"], .text-danger');
        for (const el of errorElements) {
          if (el.textContent.trim()) return el.textContent.trim();
        }
        return null;
      });
      
      if (errorMsg) {
        throw new Error(`Form submission failed: ${errorMsg}`);
      } else {
        throw new Error('Form submitted but redirect did not happen. Still on: ' + currentUrl);
      }
    }

    console.log('Reached PMS domain: ' + currentUrl);

    // ── STEP 6: Wait for React app to render welcome message ─────────────────
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
      await page.waitForSelector('.css-35ezg3, .css-t7gog', { timeout: 15000 });
    } catch (_) {
      console.log('Welcome selector timed out, reading page anyway...');
    }

    // Extract the welcome message and username properly
    const welcomeData = await page.evaluate(() => {
      // Try to find the exact structure from your HTML
      const welcomeParagraph = document.querySelector('p.MuiTypography-root.css-t7gog');
      if (welcomeParagraph) {
        const nameSpan = welcomeParagraph.querySelector('span.MuiBox-root.css-35ezg3');
        if (nameSpan) {
          return {
            fullText: welcomeParagraph.textContent.trim(),
            userName: nameSpan.textContent.trim()
          };
        }
      }
      
      // Fallback: try to find by class names directly
      const nameSpan = document.querySelector('.css-35ezg3');
      if (nameSpan) {
        return {
          fullText: 'Welcome, ' + nameSpan.textContent.trim(),
          userName: nameSpan.textContent.trim()
        };
      }
      
      const welcomeP = document.querySelector('.css-t7gog');
      if (welcomeP) {
        const text = welcomeP.textContent.trim();
        const match = text.match(/Welcome,\s*(.+)/i);
        return {
          fullText: text,
          userName: match ? match[1].trim() : text.replace('Welcome,', '').trim()
        };
      }
      
      // Try to find any element containing "Welcome"
      for (const p of document.querySelectorAll('p, span, div')) {
        const t = p.textContent.trim();
        if (t.includes('Welcome,')) {
          const match = t.match(/Welcome,\s*(.+)/i);
          return {
            fullText: t,
            userName: match ? match[1].trim() : t.replace('Welcome,', '').trim()
          };
        }
      }
      
      // Try to find the user name in the profile section
      const profileIcon = document.querySelector('button[id="fade-button"]');
      if (profileIcon) {
        const profileText = profileIcon.textContent.trim();
        return {
          fullText: 'Welcome, ' + profileText,
          userName: profileText
        };
      }
      
      return null;
    });

    if (welcomeData) {
      console.log('PMS Dashboard loaded successfully: ' + welcomeData.fullText);
      console.log('Username: ' + welcomeData.userName);
      await page.close();
      return { 
        success: true, 
        message: 'PMS Dashboard loaded successfully',
        userName: welcomeData.userName,
        fullText: welcomeData.fullText
      };
    } else {
      await page.screenshot({ path: '/tmp/pms-no-welcome.png' });
      const bodySnippet = await page.evaluate(() => document.body.innerText.substring(0, 400));
      console.log('Page body at failure:', bodySnippet);
      
      // If we're on the PMS domain but no welcome message, still consider it a success
      // as the page loaded properly
      if (currentUrl.includes('pms.motilaloswalmf.com')) {
        console.log('On PMS domain but welcome message not found - considering success');
        await page.close();
        return { 
          success: true, 
          message: 'PMS Dashboard loaded (welcome message not found)',
          userName: 'Unknown'
        };
      }
      
      throw new Error('PMS dashboard loaded but welcome message not found');
    }

  } catch (error) {
    console.error('PMS dashboard check failed:', error.message);
    return { success: false, error: error.message, userName: null };
  }
}

// Main execution
async function main(discordClient, userPAN, userPasscode, kfintechAUM, kfintechCost) {
  console.log('Starting NAV and Login check...');
  
  // Use provided credentials or fallback to .env
  const PAN_NUMBER = userPAN || process.env.PAN_NUMBER;
  const PASSCODE = userPasscode || process.env.PASSCODE;
  
  // Store KFintech values for later use
  const kfintechValues = (kfintechAUM && kfintechCost) ? { aum: kfintechAUM, costValue: kfintechCost } : null;
  
  console.log(`Using PAN: ${PAN_NUMBER}`);
  if (kfintechValues) {
    console.log(`KFintech values: AUM=${kfintechValues.aum}, Cost=${kfintechValues.costValue}`);
  }
  
  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--window-size=1920,1080']
    });

    // Check NAV
    const page = await browser.newPage();
    
    // Set realistic viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Make Puppeteer undetectable
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });
    
    const navResult = await checkNAVWithPage(page);
    
    // Check All Funds Loading
    const allFundsResult = await checkAllFundsLoading(page);
    
    // Verify funds on beta website
    let betaVerificationResult = null;
    if (allFundsResult.success && allFundsResult.fundsData) {
      betaVerificationResult = await verifyFundsOnBeta(browser, allFundsResult.fundsData);
    }
    
    await page.close();
    
    // Check Login (can be skipped via SKIP_LOGIN_CHECK flag)
    let loginResult;
    if (SKIP_LOGIN_CHECK) {
      console.log('Skipping login check (SKIP_LOGIN_CHECK = true)...');
      loginResult = { success: true, userName: 'Skipped', skipped: true };
    } else {
      loginResult = await checkLogin(browser, discordClient, PAN_NUMBER, PASSCODE);
    }
    
    // KFintech Sync Check
    let kfintechSyncResult = null;
    if (loginResult.success && !loginResult.skipped && loginResult.portfolioData) {
      const { currentValue, totalInvestment } = loginResult.portfolioData;
      
      // Check if portfolio data was extracted successfully
      if (currentValue && totalInvestment && kfintechValues) {
        try {
          const { aum, costValue } = kfintechValues;
          
          const currentValueDiff = Math.abs(currentValue - aum);
          const totalInvestmentDiff = Math.abs(totalInvestment - costValue);
          
          const isCurrentValueMatch = currentValueDiff <= 20;
          const isTotalInvestmentMatch = totalInvestmentDiff <= 20;
          const isPerfectSync = isCurrentValueMatch && isTotalInvestmentMatch;
          
          kfintechSyncResult = {
            success: true,
            motilalOswal: { currentValue, totalInvestment },
            kfintech: { aum, costValue },
            differences: { currentValueDiff, totalInvestmentDiff },
            isPerfectSync
          };
          
          console.log('KFintech sync check completed:', kfintechSyncResult);
        } catch (error) {
          console.error('KFintech sync check failed:', error.message);
          kfintechSyncResult = { success: false, error: error.message };
        }
      } else {
        console.log('Skipping KFintech sync - portfolio data or KFintech values missing');
        kfintechSyncResult = { success: false, error: 'Portfolio data extraction failed or KFintech values not provided' };
      }
    }
    
    // Check MF Account Statement (runs after login, before logout)
    let mfAccountStatementResult;
    if (SKIP_MF_ACCOUNT_STATEMENT_CHECK) {
      console.log('Skipping MF Account Statement check (SKIP_MF_ACCOUNT_STATEMENT_CHECK = true)...');
      mfAccountStatementResult = { success: true, skipped: true };
    } else if (loginResult.success && !loginResult.skipped) {
      mfAccountStatementResult = await checkMFAccountStatement(browser);
    } else {
      mfAccountStatementResult = { success: false, error: 'Skipped due to login check being disabled or failed' };
    }
    
    // Logout after MF checks (click logout button)
    if (loginResult.success && !loginResult.skipped) {
      console.log('Logging out from MF dashboard...');
      try {
        const logoutPage = await browser.newPage();
        
        console.log('Navigating to home page for logout...');
        await logoutPage.goto('https://invest.motilaloswalmf.com/', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Click on user profile icon to open popup
        console.log('Clicking user profile icon...');
        const profileClicked = await logoutPage.evaluate(() => {
          const profileIcon = document.getElementsByClassName('MuiBox-root css-1f3y13q')[0];
          if (profileIcon) {
            profileIcon.click();
            return true;
          }
          return false;
        });
        
        if (!profileClicked) {
          throw new Error('Profile icon not found');
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Click Logout button in popup
        console.log('Clicking Logout button...');
        const logoutClicked = await logoutPage.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const btn of buttons) {
            if (btn.textContent.includes('Logout')) {
              btn.click();
              return true;
            }
          }
          return false;
        });
        
        if (logoutClicked) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          console.log('Logged out successfully');
        } else {
          console.log('Logout button not found');
        }
        
        await logoutPage.close();
      } catch (e) {
        console.log('Logout failed:', e.message);
      }
    }
    
    // Check PMS Dashboard
    let pmsResult;
    if (SKIP_PMS_DASHBOARD_CHECK) {
      console.log('Skipping PMS dashboard check (SKIP_PMS_DASHBOARD_CHECK = true)...');
      pmsResult = { success: true, userName: 'Skipped', skipped: true };
    } else {
      pmsResult = await checkPMSDashboard(browser);
    }
    
    // Check Account Performance Report
    let accountPerfResult;
    if (SKIP_PMS_DASHBOARD_CHECK) {
      console.log('Skipping Account Performance Report check (SKIP_PMS_DASHBOARD_CHECK = true)...');
      accountPerfResult = { success: true, skipped: true };
    } else if (pmsResult.success && !pmsResult.skipped) {
      accountPerfResult = await checkAccountPerformance(browser);
    } else {
      accountPerfResult = { success: false, error: 'Skipped due to PMS Dashboard check being disabled or failed' };
    }
    
    // Build message with proper formatting
    let message = '**Good Morning Team,**\n\n**Website update**\n\n';
    
    // 1. NAV Status
    if (navResult.success && navResult.isUpdated) {
      message += '1. NAV updated properly\n';
    } else if (navResult.success && !navResult.isUpdated) {
      message += `1. NAV NOT updated (Expected: ${navResult.expectedDate}, Actual: ${navResult.actualDate})\n`;
    } else {
      message += `1. NAV check failed (Error: ${navResult.error})\n`;
    }
    
    // 2. Login Status
    if (loginResult.success && !loginResult.skipped && loginResult.isNewUser) {
      message += `2. Login working properly (New user with no investments)\n`;
    } else if (loginResult.success && !loginResult.skipped) {
      message += `2. Login working properly\n`;
    } else if (loginResult.skipped) {
      message += `2. Login check skipped\n`;
    } else {
      message += `2. Login failed (Error: ${loginResult.error})\n`;
    }
    
    // 3. MF Dashboard Status (based on login success and username extraction)
    if (loginResult.success && !loginResult.skipped && loginResult.userName) {
      message += `3. MF dashboard is loading properly\n`;
      console.log(`✅ MF Dashboard - User: ${loginResult.userName}`);
    } else if (loginResult.skipped) {
      message += `3. MF dashboard check skipped\n`;
    } else {
      message += `3. MF dashboard failed to load\n`;
    }
    
    // 4. MF Account Statement Status
    if (mfAccountStatementResult.success && !mfAccountStatementResult.skipped) {
      message += `4. Account statement report for MF working properly\n`;
    } else if (mfAccountStatementResult.skipped) {
      message += `4. Account statement report for MF check skipped\n`;
    } else {
      message += `4. Account statement report for MF failed\n`;
    }
    
    // 5. PMS Dashboard Status (based on username extraction)
    if (pmsResult.success && !pmsResult.skipped && pmsResult.userName && pmsResult.userName !== 'Unknown') {
      message += `5. PMS dashboard data is loading properly\n`;
      console.log(`✅ PMS Dashboard - User: ${pmsResult.userName}`);
    } else if (pmsResult.skipped) {
      message += `5. PMS dashboard check skipped\n`;
    } else {
      message += `5. PMS dashboard data failed to load\n`;
    }
    
    // 6. Account Performance Report Status
    if (accountPerfResult.success && !accountPerfResult.skipped) {
      message += `6. Account performance report for PMS is working fine\n`;
    } else if (accountPerfResult.skipped) {
      message += `6. Account performance report for PMS check skipped\n`;
    } else {
      message += `6. Account performance report for PMS failed\n`;
    }
    
    // 7. All Funds Loading Status
    if (allFundsResult.success) {
      message += `7. All funds loading properly (${allFundsResult.totalFunds} Direct - Growth funds)\n`;
    } else {
      message += `7. All funds loading failed (Error: ${allFundsResult.error})\n`;
    }
    
    // Beta Website Verification Report
    if (betaVerificationResult && betaVerificationResult.success) {
      message += `\n**Beta Website NAV Verification**\n\n`;
      message += `Total Funds in JSON: ${betaVerificationResult.totalInJson}\n`;
      message += `Funds Checked: ${betaVerificationResult.total}${BETA_VERIFICATION_LIMIT > 0 ? ` (Limited to ${BETA_VERIFICATION_LIMIT})` : ''}\n`;
      message += `✅ Matched: ${betaVerificationResult.matched.length}\n`;
      message += `❌ Not Matched: ${betaVerificationResult.notMatched.length}\n`;
      message += `⚠️ Not Found: ${betaVerificationResult.notFound.length}\n`;
      
      if (betaVerificationResult.notMatched.length > 0) {
        message += `\n**NAV Mismatches:**\n`;
        betaVerificationResult.notMatched.forEach(item => {
          message += `- ${item.fund}\n  Expected: ${item.expected} | Actual: ${item.actual}\n`;
        });
      }
      
      if (betaVerificationResult.notFound.length > 0) {
        message += `\n**Funds Not Found:**\n`;
        betaVerificationResult.notFound.slice(0, 5).forEach(item => {
          message += `- ${item.fund}\n`;
        });
        if (betaVerificationResult.notFound.length > 5) {
          message += `... and ${betaVerificationResult.notFound.length - 5} more\n`;
        }
      }
    }
    
    // KFintech Sync Status (after all checks)
    if (kfintechSyncResult && kfintechSyncResult.success) {
      const { motilalOswal, kfintech, differences, isPerfectSync } = kfintechSyncResult;
      const icon = isPerfectSync ? '✅' : '❌';
      
      message += `\n**KFintech Sync Status**\n\n`;
      message += `Portfolio reconciliation with KFintech\n`;
      message += `   ${icon} Motilal Oswal\n`;
      message += `      Current Value: ₹${motilalOswal.currentValue.toFixed(2)}\n`;
      message += `      Total Investment: ₹${motilalOswal.totalInvestment.toFixed(2)}\n`;
      message += `   ${icon} KFintech\n`;
      message += `      Assets Under Management: ₹${kfintech.aum.toFixed(2)}\n`;
      message += `      Cost Value: ₹${kfintech.costValue.toFixed(2)}\n`;
      message += `   ${icon} Match: ${isPerfectSync ? 'Perfect sync' : 'Not Perfect sync'}\n`;
      message += `   ⚠️ Difference: ₹${Math.max(differences.currentValueDiff, differences.totalInvestmentDiff).toFixed(2)} difference detected!\n`;
    } else if (kfintechSyncResult && !kfintechSyncResult.success) {
      message += `\n**KFintech Sync Status**\n`;
      message += `❌ KFintech sync check failed: ${kfintechSyncResult.error}\n`;
    }
    
    // Add timestamp
    const now = new Date();
    const timeStr = now.toLocaleString('en-GB', { 
      timeZone: 'Asia/Kolkata',
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true,
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    message += `\n_Report generated: ${timeStr} IST_`;
    
    await sendDiscordMessage(message);
    console.log('Check completed.');
    
  } catch (error) {
    console.error('Error:', error.message);
    await sendDiscordMessage(`❌ **Error:** ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { checkNAVUpdate, main, waitForOTP, verifyFundsOnBeta };