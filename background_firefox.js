// Import utils.js for Firefox
// Firefox doesn't use importScripts in background scripts the same way
// The utils.js is already loaded via manifest scripts array

let defaultAccount = 0;
let rules = [];
let accounts = [];

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason == "install") {
    SyncStorage.get("rules", (data) => {
      if (data.rules === undefined) {
        SyncStorage.store({ rules: [] });
      }
    });
    SyncStorage.get("defaultAccount", (data) => {
      if (data.defaultAccount === undefined) {
        SyncStorage.store({ defaultAccount: 0 });
      }
    });
  }
});

SyncStorage.get("defaultAccount", (data) => {
  defaultAccount = data.defaultAccount ?? 0;
});

SyncStorage.get("rules", (data) => {
  rules = data.rules ?? [];
});

SyncStorage.get("accounts", (data) => {
  accounts = data.accounts ?? [];
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if ("defaultAccount" in changes) {
    defaultAccount = changes["defaultAccount"].newValue;
  }
  if ("rules" in changes) {
    rules = changes["rules"].newValue;
  }
  if ("accounts" in changes) {
    accounts = changes["accounts"].newValue;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message === "fetch_google_accounts") {
    const url =
      "https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1&origin=https://accounts.google.com";
    fetch(url)
      .then((response) => response.text())
      .then(function (rawText) {
        // Use regex parsing for consistency with Chrome MV3 service worker
        // Look for the script tag and extract its content
        const scriptRegex = /<script[^>]*>(.*?)<\/script>/s;
        const scriptMatch = scriptRegex.exec(rawText);
        if (!scriptMatch) {
          throw new Error("Could not find script tag in response");
        }
        
        const scriptContent = scriptMatch[1];
        
        // Extract the JSON data from the script content
        // The data is typically in a format like: ...'],"some data here",...
        const jsonRegex = /'([^']+)'/;
        const jsonMatch = jsonRegex.exec(scriptContent);
        if (!jsonMatch) {
          throw new Error("Could not extract JSON data from script");
        }
        
        const encodedData = jsonMatch[1];
        
        // Decode the escaped data
        return encodedData
          .replace(/\\x([0-9a-fA-F]{2})/g, (match, paren) =>
            String.fromCharCode(parseInt(paren, 16))
          )
          .replace(/\\\//g, "/")
          .replace(/\\n/g, "");
      })
      .then((text) => JSON.parse(text))
      .then(sendResponse)
      .catch((error) => {
        console.error("Error fetching Google accounts:", error);
        sendResponse({ error: error.message });
      });
    return true;
  }
});

// collect last 4 redirectUrls
let last4RedirectUrls = [];
const maxRedirectTimeMS = 250;

function detectRedirectCycle(redirectUrl) {
  const currentTime = new Date().getTime();
  if (last4RedirectUrls.length === 0) {
    last4RedirectUrls.push({ time: currentTime, redirectUrl });
    return false;
  }
  const lastRedirect = last4RedirectUrls[last4RedirectUrls.length - 1];
  if (currentTime - lastRedirect.time > maxRedirectTimeMS) {
    last4RedirectUrls = [];
  }
  if (lastRedirect.redirectUrl === redirectUrl) {
    last4RedirectUrls.push({ time: currentTime, redirectUrl });
  }
  return last4RedirectUrls.length >= 4;
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (
      details.url &&
      // filter only get requests from the main_frame (user-initiated)
      details.method === "GET" &&
      // test if it's one of the Google services
      isGoogleServiceUrl(details.url) &&
      // test if the URL does not contain "authuser" or "/u/0"
      details.url.toLowerCase().indexOf("authuser") < 0 &&
      !/https?:\/\/.*\.google\.co.*\/u\/\d+/i.test(details.url)
    ) {
      // Check google service is Docs, do not redirect on document creation
      if (
        details.url.includes("docs.google") &&
        details.url.includes("/create")
      ) {
        return;
      }
      //
      const accountId = getAccountForService(details.url);
      const redirectUrl = convertToRedirectUrl(details.url, accountId);
      // Cos with "0" there are many redirect problems, and Google handles it anyway
      // isAccountLoggedIn - cos there will be ERR_TOO_MANY_REDIRECTS
      if (redirectUrl && accountId !== 0 && isAccountLoggedIn(accountId)) {
        if (detectRedirectCycle(redirectUrl)) return; // ERR_TOO_MENY_REQUESTS (detecting a redirect cycle)
        return { redirectUrl };
      }
    }
  },
  // filters
  {
    // types: ["main_frame", "sub_frame"],
    types: ["main_frame"],
    urls: ["<all_urls>"],
  },
  // extraInfoSpec
  ["blocking"]
);

// Helper function to extract base service URL from Google URLs
function getBaseServiceUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // For standard Google service subdomains (e.g., mail.google.com, drive.google.com)
    if (hostname.includes('.google.co')) {
      const servicePart = hostname.split('.google.co')[0];
      return servicePart + '.google.com'; // Normalize to .com for consistency
    }
    
    // For Google.com paths (e.g., google.com/maps, google.com/finance)
    if (hostname.includes('google.co')) {
      const pathParts = urlObj.pathname.split('/');
      if (pathParts.length > 1 && pathParts[1]) {
        return hostname + '/' + pathParts[1];
      }
      return hostname;
    }
    
    return hostname;
  } catch (e) {
    console.error('[Firefox] Error extracting base service URL:', e);
    return url;
  }
}

// Track processed services per tab for Firefox (simpler than Chrome version)
const processedServices = new Map();

// Track tabs that should temporarily skip redirects (for account switching)
const temporarySkipRedirects = new Map();

// Temporarily skip redirects for a tab (useful for account switching)
function temporarilySkipRedirects(tabId, duration = 15000) {
  temporarySkipRedirects.set(tabId, Date.now() + duration);
  console.log("[Firefox] Temporarily skipping redirects for tab", tabId, "for", duration, "ms");
}

// Check if redirects should be temporarily skipped for a tab
function shouldTemporarilySkipRedirects(tabId) {
  const skipUntil = temporarySkipRedirects.get(tabId);
  if (!skipUntil) return false;
  
  if (Date.now() > skipUntil) {
    temporarySkipRedirects.delete(tabId);
    return false;
  }
  
  return true;
}

// Clean up old processed services periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  for (const [tabId, tabData] of processedServices.entries()) {
    const servicesToRemove = [];
    
    for (const [service, timestamp] of tabData.entries()) {
      if (now - timestamp > maxAge) {
        servicesToRemove.push(service);
      }
    }
    
    servicesToRemove.forEach(service => tabData.delete(service));
    
    // Remove tab entry if no services remain
    if (tabData.size === 0) {
      processedServices.delete(tabId);
    }
  }
}, 10 * 60 * 1000); // Run every 10 minutes

// Helper function to extract authuser parameter from URL (Firefox)
function extractAuthUserFromUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Check for authuser parameter
    const authUserParam = urlObj.searchParams.get('authuser');
    if (authUserParam !== null) {
      return parseInt(authUserParam, 10);
    }
    
    // Check for /u/{number}/ pattern in path
    const uPattern = /\/u\/(\d+)\//;
    const match = uPattern.exec(urlObj.pathname);
    if (match) {
      return parseInt(match[1], 10);
    }
    
    return null;
  } catch (e) {
    console.error('[Firefox] Error extracting authuser from URL:', e);
    return null;
  }
}

// Helper function to detect account switcher URLs (Firefox)
function isAccountSwitcherUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();
    
    // Common account switcher patterns
    const switcherPatterns = [
      'accounts.google.com',
      '/accounts/',
      '/accountchooser',
      '/signin',
      '/logout',
      '/servicelogin',
      '/listaccounts'
    ];
    
    return switcherPatterns.some(pattern => 
      hostname.includes(pattern) || pathname.includes(pattern)
    );
  } catch (e) {
    console.error('[Firefox] Error checking account switcher URL:', e);
    return false;
  }
}

// Helper function to handle Google service redirects
function handleGoogleServiceRedirect(tabId, url) {
  if (!isGoogleServiceUrl(url) || isAccountSwitcherUrl(url)) {
    return false;
  }
  
  // Check if redirects should be temporarily skipped for this tab
  if (shouldTemporarilySkipRedirects(tabId)) {
    console.log("[Firefox] Temporarily skipping redirect for tab", tabId, "due to recent account switching activity");
    return false;
  }
  
  const baseService = getBaseServiceUrl(url);
  const currentAuthUser = extractAuthUserFromUrl(url);
  const accountId = getAccountForService(url);
  
  // Check if URL already has the correct authuser
  if (currentAuthUser === accountId) {
    markServiceAsProcessed(tabId, baseService);
    return false;
  }
  
  if (shouldSkipFirefoxRedirect(tabId, baseService, currentAuthUser)) {
    return false;
  }
  
  const redirectUrl = convertToRedirectUrl(url, accountId);
  if (redirectUrl && redirectUrl !== url) {
    console.log("[Firefox] Redirecting to service", baseService, ":", redirectUrl);
    markServiceAsProcessed(tabId, baseService);
    chrome.tabs.update(tabId, { url: redirectUrl });
    return true;
  }
  
  markServiceAsProcessed(tabId, baseService);
  return false;
}

// Helper function to check if Firefox redirect should be skipped
function shouldSkipFirefoxRedirect(tabId, baseService, currentAuthUser) {
  const tabData = processedServices.get(tabId);
  const hasBeenProcessedForService = tabData?.has(baseService);
  
  if (currentAuthUser !== null && hasBeenProcessedForService) {
    const lastProcessedTime = tabData.get(baseService);
    const timeSinceLastProcess = Date.now() - lastProcessedTime;
    const cooldownPeriod = 5000; // 5 seconds cooldown
    
    if (timeSinceLastProcess < cooldownPeriod) {
      console.log("[Firefox] Cooldown period active for service", baseService);
      return true;
    }
    
    console.log("[Firefox] User changed account for service", baseService, ", updating tracking");
    processedServices.get(tabId).set(baseService, Date.now());
    return true;
  }
  
  return false;
}

// Helper function to mark service as processed
function markServiceAsProcessed(tabId, baseService) {
  if (!processedServices.has(tabId)) {
    processedServices.set(tabId, new Map());
  }
  processedServices.get(tabId).set(baseService, Date.now());
}

chrome.tabs.onCreated.addListener((tab) => {
  const url = tab.pendingUrl || tab.url;
  if (!url) return;
  
  // Check if this is a Google account switcher URL
  if (isAccountSwitcherUrl(url)) {
    console.log("[Firefox] Account switcher URL detected in new tab, skipping redirect");
    return;
  }
  
  if (tab.openerTabId) {
    chrome.tabs.get(tab.openerTabId, (openerTab) => {
      if (chrome.runtime.lastError) {
        handleGoogleServiceRedirect(tab.id, url);
        return;
      }
      
      // If the opener is a Google service and we have a new tab, this might be account switching
      if (openerTab && isGoogleServiceUrl(openerTab.url)) {
        console.log("[Firefox] New tab opened from Google service:", openerTab.url);
        
        // If the new URL is any Google URL, temporarily skip redirects
        if (isAnyGoogleUrl(url)) {
          console.log("[Firefox] Google-to-Google navigation detected, temporarily skipping redirects");
          temporarilySkipRedirects(tab.id, 15000); // 15 seconds
          temporarilySkipRedirects(tab.openerTabId, 15000);
          return;
        }
      }
      
      handleGoogleServiceRedirect(tab.id, url);
    });
  } else {
    handleGoogleServiceRedirect(tab.id, url);
  }
});

// Handle navigation in existing tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process when URL is changing and the change is committed
  if (changeInfo.status === 'loading' && changeInfo.url) {
    // Check if this is a Google account switcher URL
    if (isAccountSwitcherUrl(changeInfo.url)) {
      console.log("[Firefox] Account switcher URL detected in tab update, skipping redirect");
      return;
    }
    
    handleGoogleServiceRedirect(tabId, changeInfo.url);
  }
});

// Clean up processed services when tabs are removed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const removedData = processedServices.get(tabId);
  processedServices.delete(tabId);
  temporarySkipRedirects.delete(tabId);
  
  if (removedData) {
    console.log("[Firefox] Cleaned up processed tab:", tabId, "with services:", Array.from(removedData.keys()));
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command?.indexOf("switch_to_ga_") >= 0) {
    try {
      const accNum = parseInt(command.charAt(command.length - 1)) - 1;
      SyncStorage.get("accounts", (data) => {
        // redirect only if accNum is not > than totla number of accounts
        if (data.accounts && data.accounts.length > accNum) {
          redirectCurrectTab(accNum);
        }
      });
    } catch {}
  }
});

// checks if the account is logged in (to redirect only logged in Accounts)
function isAccountLoggedIn(accountIndex) {
  return Boolean(accounts[accountIndex]?.isLoggedIn);
}

function getAccountForService(url) {
  for (const rule of rules) {
    const reg = new RegExp(
      `^https?://[^?&]*${rule.serviceName.toLowerCase()}\\.google\\.co.*`,
      "is"
    );
    if (reg.test(url)) {
      return rule.accountId;
    }
  }
  return defaultAccount;
}
