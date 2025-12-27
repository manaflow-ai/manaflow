# cmux iOS App

## Build Configs
| Config | Bundle ID | App Name | Signing |
|--------|-----------|----------|---------|
| Debug | `dev.cmux.app.dev` | cmux DEV | Automatic |
| Beta | `dev.cmux.app.beta` | cmux Beta | Manual |
| Release | `dev.cmux.app` | cmux | Manual |

## Simulator
```bash
xcodegen generate
xcodebuild -scheme cmux -sdk iphonesimulator -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build
xcrun simctl install booted "build/Build/Products/Debug-iphonesimulator/cmux DEV.app"
xcrun simctl launch booted dev.cmux.app.dev
```

## TestFlight
```bash
./scripts/testflight.sh  # Auto-increments build number, archives, uploads
```

Build numbers in `project.yml` (`CURRENT_PROJECT_VERSION`). Limit: 100 per version.

## Notes
- **arm64 only**: ConvexMobile doesn't support x86_64
- **Dev shortcut**: Enter `42` as email to auto-login (DEBUG only, needs test user in Stack Auth)
- **Encryption**: `ITSAppUsesNonExemptEncryption: false` set in project.yml
