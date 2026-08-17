import UIKit
import Capacitor

/// Registers app-local Capacitor plugins that live directly in this target
/// rather than as their own SPM package products.
///
/// Capacitor's bridge auto-discovers plugins that arrive via an SPM package
/// product (that's how `Capacitor`, `Cordova`, and the `CapacitorHaptics` /
/// `CapacitorLocalNotifications` / `CapacitorShare` / `CapacitorStatusBar`
/// products in CapApp-SPM get wired up). A loose source file compiled
/// straight into the App target — like GameCenterPlugin.swift — is not a
/// package product, so it is never auto-discovered. It has to be handed to
/// the bridge explicitly, which is what this override does.
///
/// Main.storyboard's root view controller class was changed from the stock
/// CAPBridgeViewController to this subclass so capacitorDidLoad() actually
/// runs.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
    }
}
