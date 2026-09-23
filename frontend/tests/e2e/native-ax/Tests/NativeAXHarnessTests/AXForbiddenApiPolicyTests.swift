import Foundation
import XCTest

private func helperSources() throws -> String {
  let root = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("Sources/NativeAXLifecycleHelper")
  guard FileManager.default.fileExists(atPath: root.path) else {
    throw NSError(domain: "NativeAXHarness", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "NATIVE_AX_HELPER_SOURCE_MISSING",
    ])
  }
  let files = try FileManager.default.subpathsOfDirectory(atPath: root.path)
  return try files
    .map { root.appendingPathComponent($0) }
    .filter { ["swift", "m", "mm", "c", "h"].contains($0.pathExtension) }
    .map { try String(contentsOf: $0, encoding: .utf8) }
    .joined(separator: "\n")
}

final class AXForbiddenApiPolicyTests: XCTestCase {
  func testNoForbiddenGlobalAXOrInputAPIsCanEnterHelperSource() throws {
    let source = try helperSources()
    for forbidden in [
      "AXUIElementCreateSystemWide",
      "AXUIElementPostKeyboardEvent",
      "CGEventPost",
      "CGEventTapCreate",
      "CGEventCreateMouseEvent",
      "CGEventCreateScrollWheelEvent",
      "kCGHIDEventTap",
      "CGWarpMouseCursorPosition",
      "NSPasteboard",
      "AppleScript",
      "System Events",
      "CUA",
      "ScriptingBridge",
      "NSAppleScript",
      "osascript",
      "AXObserverCreate",
      "NSEvent.post",
      "keyCode",
      "mouseLocation",
      "CGWindowListCopyWindowInfo",
      "NSWorkspace.shared",
      "runningApplications",
      "accessibilityFocusedUIElement",
      "document.visibilityState",
      "dispatchEvent",
      "bringToFront",
      "kAXFocusedApplicationAttribute",
    ] {
      XCTAssertFalse(source.contains(forbidden), "NATIVE_AX_FORBIDDEN_API_PRESENT:\(forbidden)")
    }
  }
}
