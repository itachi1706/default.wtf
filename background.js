// Import utils.js for service worker
importScripts('utils.js');

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
  // Initialize dynamic rules for declarativeNetRequest
  initializeDeclarativeNetRequestRules();
});

// Initialize state when service worker starts
async function initializeState() {
  const [defaultAccountData, rulesData, accountsData] = await Promise.all([
    new Promise(resolve => SyncStorage.get("defaultAccount", resolve)),
    new Promise(resolve => SyncStorage.get("rules", resolve)),
    new Promise(resolve => SyncStorage.get("accounts", resolve))
  ]);
  
  defaultAccount = defaultAccountData.defaultAccount ?? 0;
  rules = rulesData.rules ?? [];
  accounts = accountsData.accounts ?? [];
}

// Call initialize on startup
initializeState();

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if ("defaultAccount" in changes) {
    defaultAccount = changes["defaultAccount"].newValue;
    updateDeclarativeNetRequestRules();
  }
  if ("rules" in changes) {
    rules = changes["rules"].newValue;
    updateDeclarativeNetRequestRules();
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
        // Service workers don't have DOMParser, so we'll parse the script content manually
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

// Initialize and update declarativeNetRequest rules
async function initializeDeclarativeNetRequestRules() {
  // Clear existing rules
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const ruleIdsToRemove = existingRules.map(rule => rule.id);
  console.log("[DNR] Existing rules found:", existingRules);
  console.log("[DNR] Removing existing rules:", ruleIdsToRemove);
  if (ruleIdsToRemove.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIdsToRemove
    });
  }
  await updateDeclarativeNetRequestRules();
}

async function updateDeclarativeNetRequestRules() {
  // Clear existing rules first
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const ruleIdsToRemove = existingRules.map(rule => rule.id);
  console.log("[DNR] Existing rules before update:", existingRules);
  console.log("[DNR] Rule IDs to remove:", ruleIdsToRemove);
  // Create new rules based on current state
  const newRules = [];
  let ruleId = 1;
  // Create rules for Google services that don't have authuser parameter
  const googleServicePatterns = [
    "*://*.mail.google.com/*",
    "*://*.drive.google.com/*", 
    "*://*.calendar.google.com/*",
    "*://*.meet.google.com/*",
    "*://*.docs.google.com/*",
    "*://*.admin.google.com/*",
    "*://*.photos.google.com/*",
    "*://*.translate.google.com/*",
    "*://*.keep.google.com/*",
    "*://*.hangouts.google.com/*",
    "*://*.chat.google.com/*",
    "*://*.workspace.google.com/*",
    "*://*.maps.google.com/*",
    "*://*.news.google.com/*",
    "*://*.ads.google.com/*",
    "*://*.ediscovery.google.com/*",
    "*://*.jamboard.google.com/*",
    "*://*.earth.google.com/*",
    "*://*.podcasts.google.com/*",
    "*://*.classroom.google.com/*",
    "*://*.business.google.com/*",
    "*://*.myaccount.google.com/*",
    "*://*.adsense.google.com/*",
    "*://*.cloud.google.com/*",
    "*://*.adwords.google.com/*",
    "*://*.analytics.google.com/*",
    "*://*.firebase.google.com/*",
    "*://*.play.google.com/*",
    "*://*.voice.google.com/*",
    "*://*.tagmanager.google.com/*",
    "*://*.duo.google.com/*",
    "*://*.datastudio.google.com/*",
    "*://*.optimize.google.com/*",
    "*://*.merchants.google.com/*",
    "*://*.finance.google.com/*",
    "*://*.colab.research.google.com/*",
    "*://*.contacts.google.com/*",
    "*://*.script.google.com/*",
    "*://*.messages.google.com/*",
    "*://*.search.google.com/*",
    "*://*.stadia.google.com/*",
    "*://*.developers.google.com/*",
    "*://*.one.google.com/*",
    "*://*.chrome.google.com/*",
    "*://*.books.google.com/*",
    "*://*.sites.google.com/*",
    "*://*.groups.google.com/*",
    "*://*.gemini.google.com/*",
    "*://www.google.com/maps*",
    "*://www.google.com/finance*",
    "*://www.google.com/travel*",
    "*://www.google.com/flights*"
  ];
  
  for (const pattern of googleServicePatterns) {
    newRules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: [
                { key: "authuser", value: defaultAccount.toString() }
              ]
            }
          }
        }
      },
      condition: {
        urlFilter: pattern,
        resourceTypes: ["main_frame"],
        excludedRequestDomains: ["accounts.google.com"]
      }
    });
  }
  // Update rules
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: ruleIdsToRemove,
    addRules: newRules
  });
  console.log("[DNR] Updated declarativeNetRequest rules:", newRules);
}

// collect last 4 redirectUrls - keeping for compatibility but not used in MV3
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

// Legacy webRequest code removed - replaced with declarativeNetRequest above

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
    console.error('[DNR] Error extracting base service URL:', e);
    return url;
  }
}

// Track tabs and their processed services to detect first-time navigation per service (Chrome only)
const processedTabs = new Map();

// Clean up old processed tabs periodically (Chrome only)
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  for (const [tabId, tabData] of processedTabs.entries()) {
    const servicesToRemove = [];
    
    for (const [service, data] of tabData.entries()) {
      if (now - data.timestamp > maxAge) {
        servicesToRemove.push(service);
      }
    }
    
    servicesToRemove.forEach(service => tabData.delete(service));
    
    // Remove tab entry if no services remain
    if (tabData.size === 0) {
      processedTabs.delete(tabId);
      if (chrome.declarativeNetRequestFeedback) {
        console.log("[DNR] Cleaned up old processed tab:", tabId);
      }
    } else if (servicesToRemove.length > 0 && chrome.declarativeNetRequestFeedback) {
      console.log("[DNR] Cleaned up old processed services for tab", tabId, ":", servicesToRemove);
    }
  }
}, 10 * 60 * 1000); // Run every 10 minutes

// Helper function to check if redirect should be skipped
function shouldSkipRedirect(tabId, url, isFirstNavigation) {
  const baseService = getBaseServiceUrl(url);
  const tabData = processedTabs.get(tabId);
  const isFirstTimeForService = isFirstNavigation || !tabData?.has(baseService);
  const hasAuthUser = url.toLowerCase().includes("authuser") || /\/u\/\d+/.test(url);
  
  if (!hasAuthUser) return false;
  
  if (!isFirstTimeForService) {
    if (chrome.declarativeNetRequestFeedback) {
      console.log("[DNR] URL already has authuser and not first navigation for service", baseService, ", skipping redirect");
    }
    return true;
  }
  
  if (chrome.declarativeNetRequestFeedback) {
    console.log("[DNR] First navigation to service", baseService, "with authuser - will override with default account");
  }
  return false;
}

// Helper function to handle Google service redirects
function handleGoogleServiceRedirect(tabId, url, isFirstNavigation = false) {
  if (!isGoogleServiceUrl(url)) return false;
  
  if (shouldSkipRedirect(tabId, url, isFirstNavigation)) return false;
  
  const accountId = getAccountForService(url);
  const redirectUrl = convertToRedirectUrl(url, accountId);
  const baseService = getBaseServiceUrl(url);
  
  if (redirectUrl && redirectUrl !== url) {
    if (chrome.declarativeNetRequestFeedback) {
      console.log("[DNR] Redirecting tab from:", url);
      console.log("[DNR] Redirecting tab to:", redirectUrl);
      console.log("[DNR] Service:", baseService);
      console.log("[DNR] Is first navigation to service:", isFirstNavigation || !processedTabs.get(tabId)?.has(baseService));
    }
    
    // Mark this service as processed for this tab
    if (!processedTabs.has(tabId)) {
      processedTabs.set(tabId, new Map());
    }
    processedTabs.get(tabId).set(baseService, {
      url: redirectUrl,
      timestamp: Date.now()
    });
    
    chrome.tabs.update(tabId, { url: redirectUrl });
    return true;
  }
  
  // Mark service as processed even if no redirect needed
  const tabData = processedTabs.get(tabId);
  const isFirstTimeForService = isFirstNavigation || !tabData?.has(baseService);
  if (isFirstTimeForService) {
    if (!processedTabs.has(tabId)) {
      processedTabs.set(tabId, new Map());
    }
    processedTabs.get(tabId).set(baseService, {
      url: url,
      timestamp: Date.now()
    });
    
    if (chrome.declarativeNetRequestFeedback) {
      console.log("[DNR] Marked service", baseService, "as processed for tab", tabId);
    }
  }
  
  return false;
}

chrome.tabs.onCreated.addListener((tab) => {
  const url = tab.pendingUrl || tab.url;
  if (chrome.declarativeNetRequestFeedback) {
    console.log("[DNR] Tab created with URL:", url);
    console.log("[DNR] Check if Google service URL:", isGoogleServiceUrl(url));
  }
  if (!url) return;
  
  if (tab.openerTabId) {
    chrome.tabs.get(tab.openerTabId, (openerTab) => {
      if (openerTab && isAnyGoogleUrl(openerTab.url)) return;
      handleGoogleServiceRedirect(tab.id, url, true); // Mark as first navigation
    });
  } else {
    handleGoogleServiceRedirect(tab.id, url, true); // Mark as first navigation
  }
});

// Handle navigation in existing tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process when URL is changing and the change is committed
  if (changeInfo.status === 'loading' && changeInfo.url) {
    if (chrome.declarativeNetRequestFeedback) {
      console.log("[DNR] Tab updated with URL:", changeInfo.url);
    }
    handleGoogleServiceRedirect(tabId, changeInfo.url, false); // Not first navigation
  }
});

// Clean up processed tabs when they are removed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const removedData = processedTabs.get(tabId);
  processedTabs.delete(tabId);
  if (chrome.declarativeNetRequestFeedback && removedData) {
    console.log("[DNR] Cleaned up processed tab:", tabId, "with services:", Array.from(removedData.keys()));
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


// Declarative check

// Listen for matched DNR rules if feedback permission is present
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    console.log('[DNR] Rule matched:', info);
  });
}