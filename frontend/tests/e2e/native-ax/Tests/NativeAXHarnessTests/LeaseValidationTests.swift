import Foundation
import XCTest

#if canImport(NativeAXLifecycleHelper)
@testable import NativeAXLifecycleHelper

private struct TestLeaseCase {
  let name: String
  let observedLease: NativeAXProcessLease
  let axElementPids: [pid_t]
  let windowCount: Int
}

private func testBrowserLease() -> NativeAXProcessLease {
  NativeAXProcessLease(
    pid: 4242,
    birthTime: 10_000,
    executableRealpath: "/tmp/native-ax/browser",
    parentChain: [NativeAXProcessIdentity(pid: 4000, birthTime: 9_000)],
    profile: NativeAXProfileIdentity(device: 100, inode: 200, mode: 0o700, marker: "marker"),
    role: .browser,
  )
}

private func rejectedLeaseCases(from valid: NativeAXProcessLease) -> [TestLeaseCase] {
  [
    TestLeaseCase(name: "recycled-pid-birth-time", observedLease: valid.copy(birthTime: 9_999), axElementPids: [4242], windowCount: 1),
    TestLeaseCase(name: "changed-executable", observedLease: valid.copy(executableRealpath: "/Applications/Chrome.app/Chrome"), axElementPids: [4242], windowCount: 1),
    TestLeaseCase(name: "changed-parent", observedLease: valid.copy(parentChain: []), axElementPids: [4242], windowCount: 1),
    TestLeaseCase(name: "changed-profile-device", observedLease: valid.copy(profile: valid.profile.copy(device: 101)), axElementPids: [4242], windowCount: 1),
    TestLeaseCase(name: "changed-profile-inode", observedLease: valid.copy(profile: valid.profile.copy(inode: 201)), axElementPids: [4242], windowCount: 1),
    TestLeaseCase(name: "changed-profile-mode", observedLease: valid.copy(profile: valid.profile.copy(mode: 0o755)), axElementPids: [4242], windowCount: 1),
    TestLeaseCase(name: "changed-marker", observedLease: valid.copy(profile: valid.profile.copy(marker: "other")), axElementPids: [4242], windowCount: 1),
    TestLeaseCase(name: "foreign-ax-pid", observedLease: valid, axElementPids: [9999], windowCount: 1),
    TestLeaseCase(name: "zero-windows", observedLease: valid, axElementPids: [4242], windowCount: 0),
    TestLeaseCase(name: "multiple-windows", observedLease: valid, axElementPids: [4242, 4242], windowCount: 2),
  ]
}

private final class TestNativeAXKernel: NativeAXKernelProbe {
  private let identity: NativeAXProcessLease
  private let axElementPids: [pid_t]
  private let windowCount: Int
  private(set) var axReadCount = 0
  private(set) var validationEvents: [String] = []

  init(identity: NativeAXProcessLease, axElementPids: [pid_t], windowCount: Int) {
    self.identity = identity
    self.axElementPids = axElementPids
    self.windowCount = windowCount
  }

  func observeLease(for role: NativeAXLeaseRole) -> NativeAXProcessLease {
    identity
  }

  func validateBeforeAX(_ event: String) {
    validationEvents.append(event)
  }

  func readWindows(pid: pid_t) -> [NativeAXWindowIdentity] {
    axReadCount += 1
    return axElementPids.prefix(windowCount).map { NativeAXWindowIdentity(pid: $0) }
  }
}
#endif

private func nativeRoot() -> URL {
  URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
}

private func helperSource(named file: String) throws -> String {
  let source = nativeRoot()
    .appendingPathComponent("Sources/NativeAXLifecycleHelper")
    .appendingPathComponent(file)
  guard FileManager.default.fileExists(atPath: source.path) else {
    throw NSError(domain: "NativeAXHarness", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "NATIVE_AX_HELPER_SOURCE_MISSING",
    ])
  }
  return try String(contentsOf: source, encoding: .utf8)
}

final class LeaseValidationTests: XCTestCase {
  func testLeaseValidatorAcceptsOnlyFreshExactOwnedIdentity() throws {
    #if canImport(NativeAXLifecycleHelper)
    let validLease = testBrowserLease()
    let kernel = TestNativeAXKernel(
      identity: validLease,
      axElementPids: [4242],
      windowCount: 1,
    )
    let validator = NativeAXLeaseValidator(kernel: kernel)
    XCTAssertEqual(
      validator.validate(validLease),
      .accepted,
      "NATIVE_AX_LEASE_VALID_IDENTITY_REJECTED",
    )
    for testCase in rejectedLeaseCases(from: validLease) {
      let kernel = TestNativeAXKernel(
        identity: testCase.observedLease,
        axElementPids: testCase.axElementPids,
        windowCount: testCase.windowCount,
      )
      let validator = NativeAXLeaseValidator(kernel: kernel)
      XCTAssertEqual(
        validator.validate(validLease),
        .te,
        "NATIVE_AX_LEASE_MUTATION_ACCEPTED:\(testCase.name)",
      )
      XCTAssertEqual(kernel.axReadCount, 0, "NATIVE_AX_LEASE_READ_AX_BEFORE_VALIDATION:\(testCase.name)")
    }
    #else
    XCTFail("NATIVE_AX_HELPER_MODULE_MISSING")
    #endif
  }

  func testEveryAXReadAndActionPerformsFreshLeaseValidation() throws {
    #if canImport(NativeAXLifecycleHelper)
    let kernel = TestNativeAXKernel(
      identity: testBrowserLease(),
      axElementPids: [4242],
      windowCount: 1,
    )
    let client = NativeAXDirectClient(kernel: kernel)
    XCTAssertEqual(client.readSingleOwnedWindow(for: .browser), .accepted)
    XCTAssertEqual(client.raiseSingleOwnedWindow(for: .browser), .accepted)
    XCTAssertEqual(
      kernel.validationEvents,
      ["beforeCreateApplication", "beforeReadWindows", "beforeReadElementPid", "beforeRaise"],
      "NATIVE_AX_LEASE_VALIDATION_NOT_FRESH_PER_OPERATION",
    )
    #else
    XCTFail("NATIVE_AX_HELPER_MODULE_MISSING")
    #endif
  }

  func testEveryAXReadAndActionRequiresFreshExactLeaseValidation() throws {
    let source = try helperSource(named: "NativeAXLifecycleHelper.swift")
    for token in ["proc_pidinfo", "proc_pidpath", "fstatat", "AXUIElementCreateApplication", "AXUIElementGetPid"] {
      XCTAssertTrue(source.contains(token), "NATIVE_AX_LEASE_REQUIRED_TOKEN_MISSING:\(token)")
    }
  }

  func testLeaseValidationRejectsPIDProfileAndMarkerSubstitution() throws {
    let source = try helperSource(named: "NativeAXLifecycleHelper.swift")
    for token in ["birthTime", "parentChain", "st_dev", "st_ino", "marker"] {
      XCTAssertTrue(source.contains(token), "NATIVE_AX_LEASE_IDENTITY_CHECK_MISSING:\(token)")
    }
  }
}
