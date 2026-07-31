import Foundation
import Capacitor
import GameKit

/// Local Capacitor plugin wrapping Apple GameKit (Game Center): sign-in,
/// leaderboard score submission, and achievements.
///
/// This is a "local" plugin — it lives directly in the App target rather
/// than being a published npm package, so it doesn't need a corresponding
/// JS package. Capacitor auto-exposes it at `window.Capacitor.Plugins.GameCenter`
/// once this file is compiled into the App target (see GAME_CENTER_SETUP.md
/// for the one Xcode step required to add it to the target).
///
/// Requires iOS 14+ (see IPHONEOS_DEPLOYMENT_TARGET in project.pbxproj) so
/// the modern, non-deprecated GKLeaderboard/GKGameCenterViewController APIs
/// can be used without iOS-13 availability branching.
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlockAchievement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateAchievementProgress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showAchievements", returnType: CAPPluginReturnPromise)
    ]

    // authenticateHandler can be invoked more than once over the app's
    // lifetime (e.g. the system re-checks after returning from Settings).
    // Only the first invocation after a JS-side authenticate() call should
    // resolve that specific call; later invocations just present UI or
    // update the access point silently.
    private var pendingAuthCall: CAPPluginCall?

    @objc func authenticate(_ call: CAPPluginCall) {
        pendingAuthCall = call

        GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, error in
            guard let self = self else { return }

            if let viewController = viewController {
                // Game Center needs to show its own sign-in sheet.
                self.bridge?.viewController?.present(viewController, animated: true)
                return
            }

            if GKLocalPlayer.local.isAuthenticated {
                GKAccessPoint.shared.location = .topTrailing
                GKAccessPoint.shared.showHighlights = true
                GKAccessPoint.shared.isActive = true

                self.pendingAuthCall?.resolve([
                    "isAuthenticated": true,
                    "playerName": GKLocalPlayer.local.displayName
                ])
            } else {
                GKAccessPoint.shared.isActive = false

                self.pendingAuthCall?.resolve([
                    "isAuthenticated": false,
                    "error": error?.localizedDescription ?? ""
                ])
            }
            self.pendingAuthCall = nil
        }
    }

    @objc func submitScore(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Not authenticated with Game Center")
            return
        }
        guard let leaderboardID = call.getString("leaderboardID") else {
            call.reject("Missing leaderboardID")
            return
        }
        let score = call.getInt("score") ?? 0

        GKLeaderboard.submitScore(
            score,
            context: 0,
            player: GKLocalPlayer.local,
            leaderboardIDs: [leaderboardID]
        ) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func unlockAchievement(_ call: CAPPluginCall) {
        reportAchievement(call, percentComplete: 100.0)
    }

    @objc func updateAchievementProgress(_ call: CAPPluginCall) {
        let percent = call.getDouble("percentComplete") ?? 0.0
        reportAchievement(call, percentComplete: percent)
    }

    private func reportAchievement(_ call: CAPPluginCall, percentComplete: Double) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Not authenticated with Game Center")
            return
        }
        guard let achievementID = call.getString("achievementID") else {
            call.reject("Missing achievementID")
            return
        }

        let achievement = GKAchievement(identifier: achievementID)
        achievement.percentComplete = percentComplete
        achievement.showsCompletionBanner = true

        GKAchievement.report([achievement]) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func showLeaderboard(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Not authenticated with Game Center")
            return
        }
        let leaderboardID = call.getString("leaderboardID") ?? ""
        let gcVC = GKGameCenterViewController(
            leaderboardID: leaderboardID,
            playerScope: .global,
            timeScope: .allTime
        )
        gcVC.gameCenterDelegate = self
        self.bridge?.viewController?.present(gcVC, animated: true)
        call.resolve()
    }

    @objc func showAchievements(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Not authenticated with Game Center")
            return
        }
        let gcVC = GKGameCenterViewController(state: .achievements)
        gcVC.gameCenterDelegate = self
        self.bridge?.viewController?.present(gcVC, animated: true)
        call.resolve()
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}
