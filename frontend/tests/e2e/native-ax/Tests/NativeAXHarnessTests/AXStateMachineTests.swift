import Foundation
import XCTest

#if canImport(NativeAXLifecycleHelper)
@testable import NativeAXLifecycleHelper

private final class TestNativeAXActionRecorder: NativeAXFocusActions {
  let failingAt: NativeAXFocusAction?
  private(set) var performedActions: [NativeAXFocusAction] = []

  init(failingAt: NativeAXFocusAction? = nil) {
    self.failingAt = failingAt
  }

  func perform(_ action: NativeAXFocusAction) -> NativeAXFocusOutcome {
    performedActions.append(action)
    return action == failingAt ? .te : .accepted
  }
}

private struct TestIllegalCommandCase {
  let name: String
  let failingAction: NativeAXFocusAction?
  let run: (inout NativeAXFocusStateMachine) -> NativeAXFocusOutcome

  func apply(to machine: inout NativeAXFocusStateMachine) -> NativeAXFocusOutcome {
    run(&machine)
  }
}

private func illegalCommandCases() -> [TestIllegalCommandCase] {
  [
    TestIllegalCommandCase(name: "raise-browser-before-sink", failingAction: nil) { machine in
      machine.raiseBrowser()
    },
    TestIllegalCommandCase(name: "background-before-sink", failingAction: nil) { machine in
      machine.browserBackgroundWitnessed()
    },
    TestIllegalCommandCase(name: "duplicate-sink", failingAction: nil) { machine in
      _ = machine.confirmWitness(manualWitness: true)
      _ = machine.raiseSink()
      return machine.raiseSink()
    },
    TestIllegalCommandCase(name: "duplicate-browser", failingAction: nil) { machine in
      _ = machine.confirmWitness(manualWitness: true)
      _ = machine.raiseSink()
      _ = machine.browserBackgroundWitnessed()
      _ = machine.raiseBrowser()
      return machine.raiseBrowser()
    },
    TestIllegalCommandCase(name: "sink-action-fails", failingAction: .raiseSink) { machine in
      _ = machine.confirmWitness(manualWitness: true)
      return machine.raiseSink()
    },
    TestIllegalCommandCase(name: "browser-action-fails", failingAction: .raiseBrowser) { machine in
      _ = machine.confirmWitness(manualWitness: true)
      _ = machine.raiseSink()
      _ = machine.browserBackgroundWitnessed()
      return machine.raiseBrowser()
    },
  ]
}
#endif

private func stateMachineSource() throws -> String {
  let root = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
  let source = root.appendingPathComponent("Sources/NativeAXLifecycleHelper/AXStateMachine.swift")
  guard FileManager.default.fileExists(atPath: source.path) else {
    throw NSError(domain: "NativeAXHarness", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "NATIVE_AX_HELPER_SOURCE_MISSING",
    ])
  }
  return try String(contentsOf: source, encoding: .utf8)
}

final class AXStateMachineTests: XCTestCase {
  func testStateMachineAllowsOnlyTheOneShotSinkThenBrowserOrder() throws {
    #if canImport(NativeAXLifecycleHelper)
    let actions = TestNativeAXActionRecorder()
    var machine = NativeAXFocusStateMachine(actions: actions)
    XCTAssertEqual(machine.confirmWitness(manualWitness: true), .accepted)
    XCTAssertEqual(machine.raiseSink(), .accepted)
    XCTAssertEqual(machine.browserBackgroundWitnessed(), .accepted)
    XCTAssertEqual(machine.raiseBrowser(), .accepted)
    XCTAssertEqual(machine.close(), .accepted)
    XCTAssertEqual(
      actions.performedActions,
      [.raiseSink, .raiseBrowser],
      "NATIVE_AX_STATE_MACHINE_ACTION_ORDER_MISMATCH",
    )
    #else
    XCTFail("NATIVE_AX_HELPER_MODULE_MISSING")
    #endif
  }

  func testStateMachineTerminatesAfterDuplicateOutOfOrderOrFailedAction() throws {
    #if canImport(NativeAXLifecycleHelper)
    for command in illegalCommandCases() {
      let actions = TestNativeAXActionRecorder(failingAt: command.failingAction)
      var machine = NativeAXFocusStateMachine(actions: actions)
      XCTAssertEqual(command.apply(to: &machine), .te, "NATIVE_AX_ILLEGAL_STATE_ACCEPTED:\(command)")
      XCTAssertEqual(actions.performedActions.count <= 2, true, "NATIVE_AX_RETRIED_AFTER_ERROR:\(command)")
      XCTAssertEqual(machine.raiseBrowser(), .te, "NATIVE_AX_CONTINUED_AFTER_TERMINAL_ERROR:\(command)")
    }
    #else
    XCTFail("NATIVE_AX_HELPER_MODULE_MISSING")
    #endif
  }

  func testOnlyTheClosedOneShotAXOrderIsRepresented() throws {
    let source = try stateMachineSource()
    for state in [
      "ADMITTED",
      "LEASED",
      "WITNESS_CONFIRMED",
      "SINK_RAISED",
      "BROWSER_BACKGROUND_WITNESSED",
      "BROWSER_RAISED",
      "CLOSING",
    ] {
      XCTAssertTrue(source.contains(state), "NATIVE_AX_STATE_MISSING:\(state)")
    }
    XCTAssertTrue(source.contains("kAXRaiseAction"), "NATIVE_AX_RAISE_ACTION_MISSING")
  }
}
