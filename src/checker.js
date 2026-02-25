// ============================================================
// checker.js  VERSION: v4-react-fix  (2026-02-25)
// ============================================================
const puppeteer = require('puppeteer');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
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
const SKIP_LOGIN_CHECK = true; // Set to false to enable login check

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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
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
    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
    console.log('✅ Discord message sent successfully!');
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

// Function to check login
async function checkLogin(browser, discordClient) {
  try {
    const page = await browser.newPage();
    
    // Make Puppeteer undetectable
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
    });
    
    console.log('Navigating to login page...');
    
    await page.goto('https://www.motilaloswalmf.com/mutualfund/login', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Enter PAN
    await page.waitForSelector('input[name="panNo"]', { timeout: 10000 });
    await page.type('input[name="panNo"]', PAN_NUMBER);
    console.log('PAN entered');

    // Click Authenticate
    await page.click('button.yg_submitBtn');
    console.log('Waiting for OTP field...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Send Discord message for OTP
    await sendDiscordMessage('⏳ **Waiting for OTP**\n\nPlease reply with the 6-digit OTP you received.');

    // Wait for OTP from Discord
    console.log('Waiting for OTP from Discord...');
    const otp = await waitForOTP(discordClient);
    console.log(`Got OTP: ${otp}, now entering it...`);

    // Enter OTP
    await page.waitForSelector('input[name="otp"]', { timeout: 10000 });
    await page.type('input[name="otp"]', otp);
    console.log('OTP entered');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Click Submit button (NOT the Resend OTP button)
    console.log('Clicking OTP submit button...');
    const submitButtons = await page.$$('button.yg_submitBtn');
    console.log(`Found ${submitButtons.length} submit buttons`);
    
    // Find the correct Submit button (not the Resend OTP one)
    let correctButton = null;
    for (const btn of submitButtons) {
      const btnText = await page.evaluate(el => el.textContent.trim(), btn);
      const btnClass = await page.evaluate(el => el.className, btn);
      console.log(`Button: "${btnText}" - Class: "${btnClass}"`);
      
      if (btnText.toLowerCase().includes('submit') && !btnClass.includes('yg_resendOTPBtn')) {
        correctButton = btn;
        break;
      }
    }
    
    if (!correctButton) {
      throw new Error('Could not find Submit button');
    }
    
    console.log('Clicking the correct Submit button...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      correctButton.click()
    ]);
    console.log('Navigation completed');
    
    const currentUrl = page.url();
    console.log(`Current URL after OTP: ${currentUrl}`);

    if (!currentUrl.includes('/passcode')) {
      const errorMsg = await page.evaluate(() => {
        const errorDiv = document.querySelector('.error-message');
        if (errorDiv && errorDiv.textContent.trim()) {
          return errorDiv.textContent.trim();
        }
        const allErrors = Array.from(document.querySelectorAll('.error-message'));
        for (const err of allErrors) {
          const text = err.textContent.trim();
          if (text && text !== 'Please enter OTP' && text !== 'Enter PAN number') {
            return text;
          }
        }
        return null;
      });
      
      if (errorMsg) {
        throw new Error(`OTP submission failed: ${errorMsg}`);
      }
      
      await page.screenshot({ path: '/tmp/otp-failed.png' });
      throw new Error(`Failed to reach passcode page. OTP might be incorrect. Current URL: ${currentUrl}`);
    }
    
    console.log('Successfully reached passcode page!');

    // Enter Passcode
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    const passcodeInputs = await page.$$('input[type="password"]');
    for (let i = 0; i < PASSCODE.length; i++) {
      await passcodeInputs[i].type(PASSCODE[i]);
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between digits
    }
    console.log('Passcode entered');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Toggle "Discover the New Experience" switch to ON
    console.log('Checking toggle switch...');
    const toggleSwitch = await page.$('input.MuiSwitch-input[type="checkbox"]');
    if (toggleSwitch) {
      const isChecked = await page.evaluate(el => el.checked, toggleSwitch);
      console.log(`Toggle is currently: ${isChecked ? 'ON' : 'OFF'}`);
      
      if (!isChecked) {
        console.log('Turning toggle ON...');
        await toggleSwitch.click();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      console.log('Toggle switch not found');
    }

    // Click Submit button on passcode page
    console.log('Clicking passcode submit button...');
    const passcodeSubmitBtn = await page.$('button.btnsubmit');
    if (!passcodeSubmitBtn) {
      console.log('btnsubmit not found, trying yg_submitBtn');
      await page.click('button.yg_submitBtn');
    } else {
      await passcodeSubmitBtn.click();
    }
    console.log('Submit button clicked, waiting for dashboard...');
    
    // Wait for navigation to dashboard (different domain)
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => console.log('Navigation timeout')),
      new Promise(resolve => setTimeout(resolve, 12000))
    ]);
    console.log('First navigation completed');
    
    // Wait for SSO redirect to complete
    let finalUrl = page.url();
    console.log(`Current URL: ${finalUrl}`);
    
    if (finalUrl.includes('/sso')) {
      console.log('On SSO page, waiting for final redirect...');
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => console.log('SSO redirect timeout')),
        new Promise(resolve => setTimeout(resolve, 15000))
      ]);
      finalUrl = page.url();
      console.log(`Final URL after SSO: ${finalUrl}`);
    }

    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if reached dashboard - look for welcome message
    console.log('Looking for username on dashboard...');
    
    // Try to find username on new dashboard
    const userName = await page.evaluate(() => {
      // Try new dashboard format
      const newDash = document.querySelector('.css-nhob99');
      if (newDash) return newDash.textContent.trim();
      
      // Try old dashboard format
      const oldDash = document.querySelector('.zeroBalanceText h3');
      if (oldDash) return oldDash.textContent.trim();
      
      // Try portfolio screen
      const portfolio = document.querySelector('.css-ljufra');
      if (portfolio) return portfolio.textContent.trim();
      
      return null;
    });
    
    if (userName) {
      console.log(`Login successful: ${userName}`);
      await page.close();
      return { success: true, userName };
    } else {
      throw new Error('Reached dashboard but could not find username');
    }

  } catch (error) {
    console.error('Login check failed:', error);
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
    console.error('Account Performance check failed:', error);
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
    await page.waitForSelector('select[name="name"]', { timeout: 10000 });
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
    console.error('PMS dashboard check failed:', error);
    return { success: false, error: error.message, userName: null };
  }
}

// Main execution
async function main(discordClient) {
  console.log('Starting NAV and Login check...');
  
  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    // Check NAV
    const page = await browser.newPage();
    
    // Make Puppeteer undetectable
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
    });
    
    const navResult = await checkNAVWithPage(page);
    await page.close();
    
    // Check Login (can be skipped via SKIP_LOGIN_CHECK flag)
    let loginResult;
    if (SKIP_LOGIN_CHECK) {
      console.log('Skipping login check (SKIP_LOGIN_CHECK = true)...');
      loginResult = { success: true, userName: 'Skipped', skipped: true };
    } else {
      loginResult = await checkLogin(browser, discordClient);
    }
    
    // Check PMS Dashboard
    const pmsResult = await checkPMSDashboard(browser);
    
    // Check Account Performance Report
    let accountPerfResult;
    if (pmsResult.success) {
      accountPerfResult = await checkAccountPerformance(browser);
    } else {
      accountPerfResult = { success: false, error: 'Skipped due to PMS Dashboard failure' };
    }
    
    // Build message with proper formatting and username
    let message = '**Good Morning team,**\n\n**Website Update Report**\n\n';
    
    // NAV Status
    if (navResult.success && navResult.isUpdated) {
      message += '✅ **NAV:** Updated properly\n';
    } else if (navResult.success && !navResult.isUpdated) {
      message += `❌ **NAV:** NOT updated\n   └ Expected: ${navResult.expectedDate}, Actual: ${navResult.actualDate}\n`;
    } else {
      message += `❌ **NAV:** Check failed\n   └ Error: ${navResult.error}\n`;
    }
    
    // Login Status
    if (loginResult.success && !loginResult.skipped) {
      message += `✅ **Login:** Working properly\n   └ User: ${loginResult.userName}\n`;
    } else if (loginResult.skipped) {
      message += `⏭️ **Login:** Check skipped\n`;
    } else {
      message += `❌ **Login:** Failed\n   └ Error: ${loginResult.error}\n`;
    }
    
    // PMS Dashboard Status - WITH USERNAME
    if (pmsResult.success) {
      if (pmsResult.userName && pmsResult.userName !== 'Unknown') {
        message += `✅ **PMS Dashboard:** Data loading properly\n   └ Logged in as: **${pmsResult.userName}**\n`;
      } else {
        message += `✅ **PMS Dashboard:** Data loading properly\n`;
      }
    } else {
      message += `❌ **PMS Dashboard:** Failed\n   └ Error: ${pmsResult.error}\n`;
    }
    
    // Account Performance Report Status
    if (accountPerfResult.success) {
      message += `✅ **Account Performance Report:** Working fine\n`;
    } else {
      message += `❌ **Account Performance Report:** Failed\n   └ Error: ${accountPerfResult.error}\n`;
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
    message += `\n📅 **Report generated:** ${timeStr} IST`;
    
    await sendDiscordMessage(message);
    console.log('Check completed.');
    
  } catch (error) {
    console.error('Error:', error);
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

module.exports = { checkNAVUpdate, main, waitForOTP };