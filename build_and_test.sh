#!/bin/bash

# Extension build and test script for MV2 to MV3 conversion

echo "=== Default Account for Google™ products - MV3 Conversion ==="
echo ""

# Function to check if Chrome is installed
check_chrome() {
    if command -v google-chrome &> /dev/null || command -v chromium-browser &> /dev/null; then
        echo "✅ Chrome/Chromium detected"
        return 0
    else
        echo "❌ Chrome/Chromium not found"
        return 1
    fi
}

# Function to check if Firefox is installed
check_firefox() {
    if command -v firefox &> /dev/null; then
        echo "✅ Firefox detected"
        return 0
    else
        echo "❌ Firefox not found"
        return 1
    fi
}

# Function to validate manifest files
validate_manifests() {
    echo "Validating manifest files..."
    
    if [ -f "manifest.json" ]; then
        echo "✅ manifest.json (Chrome MV3) exists"
        # Check if it's valid JSON
        if jq empty manifest.json 2>/dev/null; then
            echo "✅ manifest.json is valid JSON"
        else
            echo "❌ manifest.json is not valid JSON"
        fi
    else
        echo "❌ manifest.json missing"
    fi
    
    if [ -f "manifest_firefox.json" ]; then
        echo "✅ manifest_firefox.json exists"
        # Check if it's valid JSON
        if jq empty manifest_firefox.json 2>/dev/null; then
            echo "✅ manifest_firefox.json is valid JSON"
        else
            echo "❌ manifest_firefox.json is not valid JSON"
        fi
    else
        echo "❌ manifest_firefox.json missing"
    fi
}

# Function to check required files
check_files() {
    echo "Checking required files..."
    
    required_files=("background.js" "background_firefox.js" "utils.js" "popup.html" "styles.css" "accounts.js" "rules.js")
    
    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            echo "✅ $file exists"
        else
            echo "❌ $file missing"
        fi
    done
    
    # Check images directory
    if [ -d "images" ]; then
        echo "✅ images directory exists"
        
        required_images=("16.png" "32.png" "48.png" "128.png" "logo.svg")
        for img in "${required_images[@]}"; do
            if [ -f "images/$img" ]; then
                echo "✅ images/$img exists"
            else
                echo "❌ images/$img missing"
            fi
        done
    else
        echo "❌ images directory missing"
    fi
}

# Function to create Chrome package
package_chrome() {
    echo "Creating Chrome MV3 package..."
    
    # Create temporary directory
    temp_dir="temp_chrome_mv3"
    rm -rf $temp_dir
    mkdir $temp_dir
    
    # Copy files for Chrome
    cp manifest.json $temp_dir/
    cp background.js $temp_dir/
    cp utils.js $temp_dir/
    cp popup.html $temp_dir/
    cp styles.css $temp_dir/
    cp accounts.js $temp_dir/
    cp rules.js $temp_dir/
    cp -r images $temp_dir/
    cp LICENSE $temp_dir/
    cp README.md $temp_dir/
    
    # Create zip file
    cd $temp_dir
    zip -r ../chrome_mv3_extension.zip ./*
    cd ..
    
    # Cleanup
    rm -rf $temp_dir
    
    echo "✅ Chrome MV3 package created: chrome_mv3_extension.zip"
}

# Function to create Firefox package
package_firefox() {
    echo "Creating Firefox package..."
    
    # Create temporary directory
    temp_dir="temp_firefox"
    rm -rf $temp_dir
    mkdir $temp_dir
    
    # Copy files for Firefox
    cp manifest_firefox.json $temp_dir/manifest.json
    cp background_firefox.js $temp_dir/background.js
    cp utils.js $temp_dir/
    cp popup.html $temp_dir/
    cp styles.css $temp_dir/
    cp accounts.js $temp_dir/
    cp rules.js $temp_dir/
    cp -r images $temp_dir/
    cp LICENSE $temp_dir/
    cp README.md $temp_dir/
    
    # Create zip file
    cd $temp_dir
    zip -r ../firefox_extension.zip ./*
    cd ..
    
    # Cleanup
    rm -rf $temp_dir
    
    echo "✅ Firefox package created: firefox_extension.zip"
}

# Main execution
echo "1. Checking browser installations..."
check_chrome
check_firefox

echo ""
echo "2. Validating files..."
validate_manifests
check_files

echo ""
echo "3. Creating packages..."

# Ask user what to package
echo "What would you like to package?"
echo "1) Chrome MV3 only"
echo "2) Firefox only"
echo "3) Both"
echo "4) Skip packaging"
read -p "Choose option (1-4): " choice

case $choice in
    1)
        package_chrome
        ;;
    2)
        package_firefox
        ;;
    3)
        package_chrome
        package_firefox
        ;;
    4)
        echo "Skipping packaging"
        ;;
    *)
        echo "Invalid choice, skipping packaging"
        ;;
esac

echo ""
echo "=== Conversion Complete ==="
echo ""
echo "Next steps:"
echo "1. Load the extension in Chrome developer mode using chrome_mv3_extension.zip"
echo "2. Load the extension in Firefox developer mode using firefox_extension.zip"
echo "3. Test all functionality including account switching and Google service redirections"
echo "4. Review MV3_CONVERSION_GUIDE.md for detailed information"
echo ""
echo "Happy testing! 🚀"
