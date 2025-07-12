# Manifest V3 Conversion Guide

This document outlines the conversion of the "Default Account for Google™ products" extension from Manifest V2 to Manifest V3.

## Key Changes Made

### 1. Manifest File Updates (`manifest.json`)

**Changes:**
- `manifest_version`: Updated from `2` to `3`
- `minimum_chrome_version`: Updated from `"40"` to `"88"` (MV3 requirement)
- `browser_action` → `action`: Renamed for MV3 compatibility
- `background.scripts` → `background.service_worker`: Changed to use service worker
- `permissions`: Split into `permissions` and `host_permissions`
- Added `declarativeNetRequest` permission to replace `webRequest` blocking

**Before (MV2):**
```json
{
  "manifest_version": 2,
  "browser_action": {
    "default_popup": "popup.html"
  },
  "background": {
    "scripts": ["utils.js", "background.js"],
    "persistent": true
  },
  "permissions": [
    "tabs",
    "storage",
    "<all_urls>",
    "webRequest",
    "webRequestBlocking"
  ]
}
```

**After (MV3):**
```json
{
  "manifest_version": 3,
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js"
  },
  "permissions": [
    "tabs",
    "storage",
    "declarativeNetRequest"
  ],
  "host_permissions": [
    "<all_urls>"
  ]
}
```

### 2. Background Script Changes (`background.js`)

**Major Changes:**

1. **Service Worker Import**: Added `importScripts('utils.js')` to import utilities
2. **State Initialization**: Added async state initialization since service workers are non-persistent
3. **WebRequest → DeclarativeNetRequest**: Replaced blocking webRequest with declarativeNetRequest rules

**Key Code Changes:**

**Import Scripts:**
```javascript
// Import utils.js for service worker
importScripts('utils.js');
```

**Async State Initialization:**
```javascript
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
```

**DeclarativeNetRequest Rules:**
```javascript
async function updateDeclarativeNetRequestRules() {
  // Clear existing rules first
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const ruleIdsToRemove = existingRules.map(rule => rule.id);
  
  // Create new rules based on current state
  const newRules = [];
  // ... rule creation logic
  
  // Update rules
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: ruleIdsToRemove,
    addRules: newRules
  });
}
```

### 3. Utils.js Improvements

**Changes Made:**
- Simplified complex regex patterns to reduce complexity
- Used optional chaining (`?.`) for safer property access
- Split complex `isGoogleServiceUrl` function into smaller, maintainable parts

**Before:**
```javascript
/^https?:\/\/[^?&]*(?:mail|drive|calendar|meet|docs|admin|photos|translate|keep|hangouts|chat|workspace|maps|news|ads|ediscovery|jamboard|earth|podcasts|classroom|business|myaccount|adsense|cloud|adwords|analytics|firebase|play|voice|tagmanager|duo|datastudio|optimize|merchants|finance|colab.research|contacts|script|messages|search|stadia|developers|one|chrome|books|sites|groups)\.google\.co.*/i.test(url)
```

**After:**
```javascript
function isGoogleServiceUrl(url) {
  const googleServices = [
    'mail', 'drive', 'calendar', 'meet', 'docs', 'admin', 'photos', 'translate',
    // ... more services
  ];
  
  for (const service of googleServices) {
    const serviceRegex = new RegExp(`^https?://[^?&]*${service}\\.google\\.co`, 'i');
    if (serviceRegex.test(url)) {
      return true;
    }
  }
  
  // ... additional checks
  return false;
}
```

## 🔧 Technical Details

### Service Worker Limitations (MV3)

The Chrome extension uses a service worker which has certain limitations compared to traditional background pages:

- ❌ **No DOM APIs**: `DOMParser`, `document`, `window` are not available
- ❌ **No persistent state**: Variables are reset when the service worker terminates
- ✅ **Web APIs**: `fetch`, `chrome.*` APIs, and basic JavaScript are available

### Google Account Fetching

Both Chrome and Firefox versions now use regex-based HTML parsing instead of `DOMParser`:

```javascript
// Service worker compatible parsing
const scriptRegex = /<script[^>]*>(.*?)<\/script>/s;
const scriptMatch = scriptRegex.exec(rawText);
const scriptContent = scriptMatch[1];

const jsonRegex = /'([^']+)'/;
const jsonMatch = jsonRegex.exec(scriptContent);
const encodedData = jsonMatch[1];
```

This approach:
- ✅ Works in both service workers and background pages
- ✅ Provides consistent behavior across browsers
- ✅ Includes proper error handling
- ✅ Maintains the same functionality

## Browser Compatibility

### Chrome (MV3)
- Uses `manifest.json` with MV3 specifications
- Uses `background.js` with service worker and declarativeNetRequest
- Minimum Chrome version: 88

### Firefox (Hybrid)
- Uses `manifest_firefox.json` with continued MV2 support
- Uses `background_firefox.js` with traditional webRequest blocking
- Firefox still supports webRequest blocking in their MV3 implementation

## Migration Notes

### Limitations of DeclarativeNetRequest
1. **Dynamic Rules**: Limited to 30,000 dynamic rules per extension
2. **Static Rules**: Better performance but less flexible
3. **Complex Logic**: Cannot perform complex JavaScript-based redirections

### Service Worker Considerations
1. **Non-Persistent**: Service workers are terminated when idle
2. **No DOM Access**: Cannot use `document` or `window` objects
3. **Import Scripts**: Must use `importScripts()` for additional files

## Testing the Extension

### Chrome
1. Load `manifest.json` in Chrome developer mode
2. Test Google service redirections
3. Verify account switching works with keyboard shortcuts

### Firefox
1. Load `manifest_firefox.json` in Firefox developer mode
2. Test webRequest-based redirections
3. Verify all functionality works as expected

## Future Considerations

1. **Rule Optimization**: Consider pre-generating static rules for better performance
2. **Error Handling**: Add more robust error handling for service worker limitations
3. **Fallback Logic**: Implement fallback mechanisms for when declarativeNetRequest fails

## Files Modified

- `manifest.json` - Updated to MV3 format
- `background.js` - Converted to service worker with declarativeNetRequest
- `utils.js` - Code quality improvements and regex simplification
- `background_firefox.js` - Created Firefox-specific background script
- `manifest_firefox.json` - Updated to use Firefox background script

## Verification Steps

1. ✅ Manifest V3 compliance
2. ✅ Service worker functionality
3. ✅ DeclarativeNetRequest rules
4. ✅ Code quality improvements
5. ✅ Firefox compatibility maintained
6. ✅ No inline scripts in popup.html (already compliant)
7. ✅ Error-free code compilation
