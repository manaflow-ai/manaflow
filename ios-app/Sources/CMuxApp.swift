import SwiftUI
import Sentry
import UIKit

@main
struct CMuxApp: App {
    init() {
        #if DEBUG
        if UITestConfig.mockDataEnabled {
            UIView.setAnimationsEnabled(false)
            resetDebugInputDefaults()
        }
        CrashReporter.install()
        DebugLog.add("App init. uiTest=\(UITestConfig.mockDataEnabled)")
        #endif
        SentrySDK.start { options in
            options.dsn = "https://834d19a3077c4adbff534dca1e93de4f@o4507547940749312.ingest.us.sentry.io/4510604800491520"
            options.debug = false

            #if DEBUG
            options.environment = "development"
            #elseif BETA
            options.environment = "beta"
            #else
            options.environment = "production"
            #endif

            options.enableTracing = true
            options.tracesSampleRate = 1.0
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }

    #if DEBUG
    private func resetDebugInputDefaults() {
        let defaults = UserDefaults.standard
        defaults.set(0.0, forKey: "debug.input.bottomInsetSingleExtra")
        defaults.set(4.0, forKey: "debug.input.bottomInsetMultiExtra")
        defaults.set(4.0, forKey: "debug.input.topInsetMultiExtra")
        defaults.set(-12.0, forKey: "debug.input.micOffset")
        defaults.set(-4.0, forKey: "debug.input.sendOffset")
        defaults.set(1.0, forKey: "debug.input.sendXOffset")
        defaults.set(34.0, forKey: "debug.input.barYOffset")
        defaults.set(10.0, forKey: "debug.input.bottomMessageGap")
        defaults.set(false, forKey: "debug.input.isMultiline")
    }
    #endif
}
