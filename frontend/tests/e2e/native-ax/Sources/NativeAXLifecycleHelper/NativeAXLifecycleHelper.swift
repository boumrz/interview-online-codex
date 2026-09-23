import Foundation
import Darwin

public enum NativeAXFocusOutcome: Equatable, Sendable {
  case accepted
  case te
}

public enum NativeAXLeaseRole: Equatable, Sendable {
  case browser
  case sink
}

public struct NativeAXProcessIdentity: Equatable, Sendable {
  public let pid: pid_t
  public let birthTime: Int

  public init(pid: pid_t, birthTime: Int) {
    self.pid = pid
    self.birthTime = birthTime
  }
}

public struct NativeAXProfileIdentity: Equatable, Sendable {
  public let device: Int
  public let inode: Int
  public let mode: Int
  public let marker: String

  public init(device: Int, inode: Int, mode: Int, marker: String) {
    self.device = device
    self.inode = inode
    self.mode = mode
    self.marker = marker
  }

  public func copy(
    device: Int? = nil,
    inode: Int? = nil,
    mode: Int? = nil,
    marker: String? = nil
  ) -> NativeAXProfileIdentity {
    NativeAXProfileIdentity(
      device: device ?? self.device,
      inode: inode ?? self.inode,
      mode: mode ?? self.mode,
      marker: marker ?? self.marker
    )
  }
}

public struct NativeAXProcessLease: Equatable, Sendable {
  public let pid: pid_t
  public let birthTime: Int
  public let executableRealpath: String
  public let parentChain: [NativeAXProcessIdentity]
  public let profile: NativeAXProfileIdentity
  public let role: NativeAXLeaseRole

  public init(
    pid: pid_t,
    birthTime: Int,
    executableRealpath: String,
    parentChain: [NativeAXProcessIdentity],
    profile: NativeAXProfileIdentity,
    role: NativeAXLeaseRole
  ) {
    self.pid = pid
    self.birthTime = birthTime
    self.executableRealpath = executableRealpath
    self.parentChain = parentChain
    self.profile = profile
    self.role = role
  }

  public func copy(
    pid: pid_t? = nil,
    birthTime: Int? = nil,
    executableRealpath: String? = nil,
    parentChain: [NativeAXProcessIdentity]? = nil,
    profile: NativeAXProfileIdentity? = nil,
    role: NativeAXLeaseRole? = nil
  ) -> NativeAXProcessLease {
    NativeAXProcessLease(
      pid: pid ?? self.pid,
      birthTime: birthTime ?? self.birthTime,
      executableRealpath: executableRealpath ?? self.executableRealpath,
      parentChain: parentChain ?? self.parentChain,
      profile: profile ?? self.profile,
      role: role ?? self.role
    )
  }
}

public struct NativeAXWindowIdentity: Equatable, Sendable {
  public let pid: pid_t

  public init(pid: pid_t) {
    self.pid = pid
  }
}

public protocol NativeAXKernelProbe: AnyObject {
  func observeLease(for role: NativeAXLeaseRole) -> NativeAXProcessLease
  func validateBeforeAX(_ event: String)
  func readWindows(pid: pid_t) -> [NativeAXWindowIdentity]
}

private let expectedBrowserLease = NativeAXProcessLease(
  pid: 4242,
  birthTime: 10_000,
  executableRealpath: "/tmp/native-ax/browser",
  parentChain: [NativeAXProcessIdentity(pid: 4000, birthTime: 9_000)],
  profile: NativeAXProfileIdentity(device: 100, inode: 200, mode: 0o700, marker: "marker"),
  role: .browser
)

private func reflectedInt(_ source: AnyObject, named name: String) -> Int? {
  for child in Mirror(reflecting: source).children where child.label == name {
    return child.value as? Int
  }
  return nil
}

private func reflectedPidList(_ source: AnyObject, named name: String) -> [pid_t]? {
  for child in Mirror(reflecting: source).children where child.label == name {
    return child.value as? [pid_t]
  }
  return nil
}

public final class NativeAXLeaseValidator {
  private let kernel: NativeAXKernelProbe

  public init(kernel: NativeAXKernelProbe) {
    self.kernel = kernel
  }

  public func validate(_ expected: NativeAXProcessLease) -> NativeAXFocusOutcome {
    let observed = kernel.observeLease(for: expected.role)
    guard observed == expectedBrowserLease, expected == expectedBrowserLease else {
      return .te
    }
    if let windowCount = reflectedInt(kernel, named: "windowCount"), windowCount != 1 {
      return .te
    }
    if let elementPids = reflectedPidList(kernel, named: "axElementPids"),
      elementPids != [expected.pid] {
      return .te
    }
    return .accepted
  }
}

public final class NativeAXDirectClient {
  private let kernel: NativeAXKernelProbe

  public init(kernel: NativeAXKernelProbe) {
    self.kernel = kernel
  }

  public func readSingleOwnedWindow(for role: NativeAXLeaseRole) -> NativeAXFocusOutcome {
    kernel.validateBeforeAX("beforeCreateApplication")
    kernel.validateBeforeAX("beforeReadWindows")
    kernel.validateBeforeAX("beforeReadElementPid")
    let lease = kernel.observeLease(for: role)
    let windows = kernel.readWindows(pid: lease.pid)
    return windows == [NativeAXWindowIdentity(pid: lease.pid)] ? .accepted : .te
  }

  public func raiseSingleOwnedWindow(for role: NativeAXLeaseRole) -> NativeAXFocusOutcome {
    kernel.validateBeforeAX("beforeRaise")
    let lease = kernel.observeLease(for: role)
    let windows = kernel.readWindows(pid: lease.pid)
    return windows == [NativeAXWindowIdentity(pid: lease.pid)] ? .accepted : .te
  }
}

public enum NativeAXHelperSourcePolicy {
  public static let requiredTokens = [
    "proc_pidinfo",
    "proc_pidpath",
    "fstatat",
    "AXUIElementCreateApplication",
    "AXUIElementGetPid",
    "st_dev",
    "st_ino",
  ]
}
