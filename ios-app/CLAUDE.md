# cmux iOS App

## Build & Run

After making code changes, you MUST rebuild and reinstall to see changes in the simulator:

```bash
# Build (must use arm64 - ConvexMobile doesn't have x86_64)
xcodebuild -scheme cmux -sdk iphonesimulator -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build

# Install to simulator
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/cmux.app

# Or launch directly (installs and opens)
xcrun simctl launch booted dev.cmux.app
```

## Architecture Note

ConvexMobile's `libconvexmobile-rs.xcframework` only supports arm64, not x86_64. Always build for an arm64 simulator (Apple Silicon Mac).

## Dev Shortcuts

- Enter `42` as email to auto-login with test credentials (DEBUG builds only)
