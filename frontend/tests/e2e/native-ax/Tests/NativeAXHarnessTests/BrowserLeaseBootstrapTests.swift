import Foundation
import XCTest

#if canImport(BrowserLeaseBootstrap)
@testable import BrowserLeaseBootstrap

private struct TestBootstrapCase {
  let name: String
  let claim: BrowserLeaseClaim?
}

private func testExpectedBootstrapLease() -> BrowserLeaseExpectedClaim {
  BrowserLeaseExpectedClaim(
    pid: 4242,
    birthTime: 10_000,
    executableRealpath: "/tmp/native-ax/Chromium",
    parentChain: [ProcessIdentity(pid: 4000, birthTime: 9_000)],
    profile: ProfileIdentity(device: 100, inode: 200, mode: 0o700, marker: "marker"),
  )
}

private func testValidBootstrapClaim() -> BrowserLeaseClaim {
  BrowserLeaseClaim(
    pid: 4242,
    birthTime: 10_000,
    executableRealpath: "/tmp/native-ax/Chromium",
    parentChain: [ProcessIdentity(pid: 4000, birthTime: 9_000)],
    profile: ProfileIdentity(device: 100, inode: 200, mode: 0o700, marker: "marker"),
    recordCount: 1,
  )
}

private func testRejectedBootstrapClaims() -> [TestBootstrapCase] {
  let valid = testValidBootstrapClaim()
  return [
    TestBootstrapCase(name: "missing", claim: nil),
    TestBootstrapCase(name: "duplicate", claim: valid.copy(recordCount: 2)),
    TestBootstrapCase(name: "stale-birth-time", claim: valid.copy(birthTime: 9_999)),
    TestBootstrapCase(name: "wrong-executable", claim: valid.copy(executableRealpath: "/Applications/Chrome.app/Chrome")),
    TestBootstrapCase(name: "wrong-parent-chain", claim: valid.copy(parentChain: [])),
    TestBootstrapCase(name: "wrong-profile-device", claim: valid.copy(profile: valid.profile.copy(device: 101))),
    TestBootstrapCase(name: "wrong-profile-inode", claim: valid.copy(profile: valid.profile.copy(inode: 201))),
    TestBootstrapCase(name: "wrong-profile-mode", claim: valid.copy(profile: valid.profile.copy(mode: 0o755))),
    TestBootstrapCase(name: "wrong-profile-marker", claim: valid.copy(profile: valid.profile.copy(marker: "other"))),
    TestBootstrapCase(name: "endpoint-bearing", claim: valid.copy(endpoint: "ws://127.0.0.1/devtools")),
  ]
}

private final class TestBootstrapLeaseRecorder: BrowserLeaseRecording {
  let wrapperPid = 4242
  private(set) var claims: [BrowserLeaseClaim] = []

  func recordClaim(_ claim: BrowserLeaseClaim) throws {
    claims.append(claim)
  }
}

private final class TestExecve: BrowserExecve {
  struct Call: Equatable {
    let path: String
  }

  private(set) var calls: [Call] = []

  func execve(path: String, argv: [String]) throws -> Never {
    calls.append(Call(path: path))
    throw BrowserLeaseBootstrapDidExec()
  }
}
#endif

final class BrowserLeaseBootstrapTests: XCTestCase {
  func testBootstrapExecveClaimUsesOneAtomicWrapperPidRecord() throws {
    #if canImport(BrowserLeaseBootstrap)
    let profile = BootstrapProfile.fixture()
    let recorder = TestBootstrapLeaseRecorder()
    let exec = TestExecve()
    let bootstrap = BrowserLeaseBootstrap(leaseRecorder: recorder, execve: exec)
    XCTAssertEqual(
      bootstrap.run(
        selectedBrowserRealpath: "/tmp/native-ax/Chromium",
        argv: ["Chromium", "--user-data-dir=\(profile.path)"],
        profile: profile,
      ),
      .didExec,
      "NATIVE_AX_BOOTSTRAP_EXECVE_NOT_REACHED",
    )
    XCTAssertEqual(recorder.claims.count, 1, "NATIVE_AX_BOOTSTRAP_CLAIM_COUNT_MISMATCH")
    XCTAssertEqual(recorder.claims[0].pid, recorder.wrapperPid, "NATIVE_AX_BOOTSTRAP_WRONG_PID_CLAIMED")
    XCTAssertEqual(exec.calls, [TestExecve.Call(path: "/tmp/native-ax/Chromium")], "NATIVE_AX_BOOTSTRAP_EXECVE_PATH_MISMATCH")
    #else
    XCTFail("NATIVE_AX_BOOTSTRAP_MODULE_MISSING")
    #endif
  }

  func testBootstrapRejectsMalformedDuplicateEndpointOrProfileSubstitutedRecords() throws {
    #if canImport(BrowserLeaseBootstrap)
    let expected = testExpectedBootstrapLease()
    for fixture in testRejectedBootstrapClaims() {
      XCTAssertEqual(
        BrowserLeaseClaimValidator.validate(fixture.claim, against: expected),
        .te,
        "NATIVE_AX_BOOTSTRAP_REJECTED_CLAIM_ACCEPTED:\(fixture.name)",
      )
    }
    #else
    XCTFail("NATIVE_AX_BOOTSTRAP_MODULE_MISSING")
    #endif
  }
}
