import Foundation
import ConvexMobile

// Convex client singleton for the app
// Docs: https://docs.convex.dev/client/swift
// API: subscribe(to:with:), mutation(_:with:), action(_:with:)

@MainActor
class ConvexClientManager: ObservableObject {
    static let shared = ConvexClientManager()

    let client: ConvexClient

    private init() {
        let env = Environment.current
        client = ConvexClient(deploymentUrl: env.convexURL)
        print("📦 Convex initialized (\(env.name)): \(env.convexURL)")
    }
}
