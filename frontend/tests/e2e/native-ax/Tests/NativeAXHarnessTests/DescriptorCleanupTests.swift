import Foundation
import XCTest

#if canImport(NativeAXLifecycleHelper)
@testable import NativeAXLifecycleHelper

private enum TestCleanupAmbiguity: String, CaseIterable {
  case snapshotDrift
  case newChild
  case reparentedChild
  case pidReuse
  case exitTimeout
  case descriptorMismatch
  case modeMismatch
  case markerMismatch
  case symlinkEntry
  case unexpectedEntry
  case cleanupError
}

private final class TestDescriptorFilesystem: DescriptorFilesystem {
  let ownedRoot: RunRootIdentity
  let ambiguity: TestCleanupAmbiguity?
  private(set) var unlinkatCalls: [CleanupLeaf] = []
  private(set) var retainedRunRoots: [RunRootIdentity] = []

  init(ownedRoot: RunRootIdentity, ambiguity: TestCleanupAmbiguity? = nil) {
    self.ownedRoot = ownedRoot
    self.ambiguity = ambiguity
  }

  func verifyFinalMarkers() -> Bool {
    ![.descriptorMismatch, .modeMismatch, .markerMismatch, .symlinkEntry, .unexpectedEntry, .cleanupError].contains(ambiguity)
  }

  func unlinkExact(_ leaf: CleanupLeaf) throws {
    if ambiguity == .cleanupError {
      throw DescriptorCleanupError.ambiguous
    }
    unlinkatCalls.append(leaf)
  }

  func retainWholeRoot() {
    retainedRunRoots.append(ownedRoot)
  }
}

private final class TestOwnedProcessLedger: OwnedProcessLedger {
  let ambiguity: TestCleanupAmbiguity?
  private(set) var closeRequests: [OwnedProcessCloseRequest] = []
  private(set) var signalsSent: [OwnedProcessSignal] = []

  init(ambiguity: TestCleanupAmbiguity? = nil) {
    self.ambiguity = ambiguity
  }

  func takeTwoSnapshots() -> OwnedSnapshotDecision {
    switch ambiguity {
    case .snapshotDrift, .newChild, .reparentedChild, .pidReuse:
      return .ambiguous
    default:
      return .stable([.browserFixture()])
    }
  }

  func requestNormalPlaywrightClose() {
    closeRequests.append(.normalPlaywrightClose)
  }

  func waitForExactExit() -> Bool {
    ambiguity != .exitTimeout
  }

  func signal(_ signal: OwnedProcessSignal) {
    signalsSent.append(signal)
  }
}
#endif

private func cleanupSource() throws -> String {
  let root = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
  let source = root.appendingPathComponent("Sources/NativeAXLifecycleHelper/DescriptorCleanup.swift")
  guard FileManager.default.fileExists(atPath: source.path) else {
    throw NSError(domain: "NativeAXHarness", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "NATIVE_AX_CLEANUP_SOURCE_MISSING",
    ])
  }
  return try String(contentsOf: source, encoding: .utf8)
}

final class DescriptorCleanupTests: XCTestCase {
  func testCleanupDeletesOnlyAfterStableSnapshotsAndVerifiedExit() throws {
    #if canImport(NativeAXLifecycleHelper)
    let fs = TestDescriptorFilesystem(ownedRoot: .fixture())
    let processes = TestOwnedProcessLedger()
    let cleanup = DescriptorAnchoredCleanup(filesystem: fs, processLedger: processes)
    XCTAssertEqual(cleanup.closeAndCleanup(), .localManualWitnessRequired)
    XCTAssertEqual(processes.closeRequests, [.normalPlaywrightClose], "NATIVE_AX_CLEANUP_DID_NOT_REQUEST_NORMAL_CLOSE_FIRST")
    XCTAssertEqual(fs.unlinkatCalls, [.browserProfile, .sinkSession, .runRoot], "NATIVE_AX_CLEANUP_NOT_EXACT_UNLINKAT_ONLY")
    XCTAssertEqual(processes.signalsSent, [], "NATIVE_AX_CLEANUP_SIGNALED_ON_SUCCESS")
    #else
    XCTFail("NATIVE_AX_CLEANUP_MODULE_MISSING")
    #endif
  }

  func testCleanupRetainsWholeRootWithNoDestructiveCallsOnEveryAmbiguity() throws {
    #if canImport(NativeAXLifecycleHelper)
    for ambiguity in TestCleanupAmbiguity.allCases {
      let fs = TestDescriptorFilesystem(ownedRoot: .fixture(), ambiguity: ambiguity)
      let processes = TestOwnedProcessLedger(ambiguity: ambiguity)
      let cleanup = DescriptorAnchoredCleanup(filesystem: fs, processLedger: processes)
      XCTAssertEqual(cleanup.closeAndCleanup(), .te, "NATIVE_AX_CLEANUP_AMBIGUITY_NOT_TE:\(ambiguity)")
      XCTAssertEqual(processes.signalsSent, [], "NATIVE_AX_CLEANUP_SIGNALED_ON_AMBIGUITY:\(ambiguity)")
      XCTAssertEqual(fs.unlinkatCalls, [], "NATIVE_AX_CLEANUP_PARTIAL_DELETE_ON_AMBIGUITY:\(ambiguity)")
      XCTAssertEqual(fs.retainedRunRoots, [.fixture()], "NATIVE_AX_CLEANUP_DID_NOT_RETAIN_ROOT:\(ambiguity)")
    }
    #else
    XCTFail("NATIVE_AX_CLEANUP_MODULE_MISSING")
    #endif
  }

  func testCleanupRequiresDescriptorAnchoredOwnedIdentity() throws {
    let source = try cleanupSource()
    for token in [
      "mkdtemp",
      "mkdirat",
      "openat",
      "O_NOFOLLOW",
      "fstatat",
      "AT_SYMLINK_NOFOLLOW",
      "unlinkat",
      "st_dev",
      "st_ino",
    ] {
      XCTAssertTrue(source.contains(token), "NATIVE_AX_CLEANUP_REQUIRED_TOKEN_MISSING:\(token)")
    }
  }

  func testCleanupRetainsEveryAmbiguousRunWithoutForcefulFallback() throws {
    let source = try cleanupSource()
    for token in ["snapshot", "retain", "Playwright", "timeout", "marker"] {
      XCTAssertTrue(source.contains(token), "NATIVE_AX_CLEANUP_SAFETY_TOKEN_MISSING:\(token)")
    }
    for forbidden in [
      "kill(",
      "SIGKILL",
      "SIGTERM",
      "rm -rf",
      "removeItem(at:",
      "FileManager.default.removeItem",
      "glob(",
      "fts_open",
      "nftw(",
      "system(",
      "/bin/rm",
      "Process()",
    ] {
      XCTAssertFalse(source.contains(forbidden), "NATIVE_AX_CLEANUP_FORBIDDEN_OPERATION_PRESENT:\(forbidden)")
    }
  }
}
