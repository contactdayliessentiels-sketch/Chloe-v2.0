#!/usr/bin/env bash
set -euo pipefail

SDK_DIR="/app/applet/.android-sdk"
mkdir -p "$SDK_DIR/cmdline-tools"

if [ ! -d "$SDK_DIR/cmdline-tools/latest" ]; then
    echo "Downloading Android commandlinetools..."
    curl -sL "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" -o "$SDK_DIR/cmdline-tools.zip"
    unzip -q "$SDK_DIR/cmdline-tools.zip" -d "$SDK_DIR/cmdline-tools"
    mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
    rm -f "$SDK_DIR/cmdline-tools.zip"
fi

echo "Accepting licenses..."
yes | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true

echo "Installing platform-tools, android-34, build-tools 34.0.0..."
"$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null 2>&1

echo "Configuring android/local.properties..."
echo "sdk.dir=$SDK_DIR" > /app/applet/android/local.properties

echo "SDK setup complete at $SDK_DIR"
