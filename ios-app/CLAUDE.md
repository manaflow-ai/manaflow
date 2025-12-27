# cmux iOS App

## Build Configurations

| Config | Bundle ID | App Name | Stack Auth | Signing |
|--------|-----------|----------|------------|---------|
| Debug | `dev.cmux.app.dev` | cmux DEV | Dev project | Automatic |
| Beta | `dev.cmux.app.beta` | cmux Beta | Prod project | Manual (Distribution) |
| Release | `dev.cmux.app` | cmux | Prod project | Manual (Distribution) |

## Build & Run (Simulator)

After making code changes, rebuild and reinstall:

```bash
# Regenerate Xcode project after changing project.yml
xcodegen generate

# Build for simulator (must use arm64 - ConvexMobile doesn't have x86_64)
xcodebuild -scheme cmux -sdk iphonesimulator -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build

# Install and launch
xcrun simctl install booted "build/Build/Products/Debug-iphonesimulator/cmux DEV.app"
xcrun simctl launch booted dev.cmux.app.dev
```

## TestFlight (Beta)

**Quick upload (recommended):**
```bash
./build/testflight.sh
```
This script auto-increments the build number, archives, and uploads to TestFlight.

**Manual steps (if needed):**
```bash
# Archive
xcodebuild -scheme cmux -configuration Beta \
  -archivePath build/cmux.xcarchive archive

# Export and upload to App Store Connect
xcodebuild -exportArchive \
  -archivePath build/cmux.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist build/ExportOptions.plist
```

**Build numbers:**
- Stored in `project.yml` as `CURRENT_PROJECT_VERSION`
- Must be unique per upload (auto-incremented by script)
- Limit: 100 builds per version number

The `ExportOptions.plist` configures:
- Method: `app-store-connect`
- Team ID: `7WLXT3NR37`
- Provisioning profile: `cmux Beta Distribution`
- Auto-upload on export

**Encryption compliance:**
- `ITSAppUsesNonExemptEncryption: false` is set in project.yml
- This skips the "Missing Compliance" prompt in App Store Connect

## Architecture Note

ConvexMobile's `libconvexmobile-rs.xcframework` only supports arm64, not x86_64. Always build for an arm64 simulator (Apple Silicon Mac).

## Dev Shortcuts

- Enter `42` as email to auto-login with test credentials (DEBUG builds only, requires test user in Stack Auth dev project)
