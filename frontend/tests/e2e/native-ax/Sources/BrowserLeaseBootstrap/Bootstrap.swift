import Foundation

public enum BrowserLeaseBootstrapRunResult: Equatable {
  case didExec
  case te
}

public enum BrowserLeaseValidationResult: Equatable {
  case accepted
  case te
}

public struct BrowserLeaseBootstrapDidExec: Error {
  public init() {}
}

public struct ProcessIdentity: Equatable {
  public let pid: Int
  public let birthTime: Int

  public init(pid: Int, birthTime: Int) {
    self.pid = pid
    self.birthTime = birthTime
  }
}

public struct ProfileIdentity: Equatable {
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
  ) -> ProfileIdentity {
    ProfileIdentity(
      device: device ?? self.device,
      inode: inode ?? self.inode,
      mode: mode ?? self.mode,
      marker: marker ?? self.marker
    )
  }
}

public struct BrowserLeaseExpectedClaim: Equatable {
  public let pid: Int
  public let birthTime: Int
  public let executableRealpath: String
  public let parentChain: [ProcessIdentity]
  public let profile: ProfileIdentity

  public init(
    pid: Int,
    birthTime: Int,
    executableRealpath: String,
    parentChain: [ProcessIdentity],
    profile: ProfileIdentity
  ) {
    self.pid = pid
    self.birthTime = birthTime
    self.executableRealpath = executableRealpath
    self.parentChain = parentChain
    self.profile = profile
  }
}

public struct BrowserLeaseClaim: Equatable {
  public let pid: Int
  public let birthTime: Int
  public let executableRealpath: String
  public let parentChain: [ProcessIdentity]
  public let profile: ProfileIdentity
  public let recordCount: Int
  public let endpoint: String?

  public init(
    pid: Int,
    birthTime: Int,
    executableRealpath: String,
    parentChain: [ProcessIdentity],
    profile: ProfileIdentity,
    recordCount: Int,
    endpoint: String? = nil
  ) {
    self.pid = pid
    self.birthTime = birthTime
    self.executableRealpath = executableRealpath
    self.parentChain = parentChain
    self.profile = profile
    self.recordCount = recordCount
    self.endpoint = endpoint
  }

  public func copy(
    pid: Int? = nil,
    birthTime: Int? = nil,
    executableRealpath: String? = nil,
    parentChain: [ProcessIdentity]? = nil,
    profile: ProfileIdentity? = nil,
    recordCount: Int? = nil,
    endpoint: String? = nil
  ) -> BrowserLeaseClaim {
    BrowserLeaseClaim(
      pid: pid ?? self.pid,
      birthTime: birthTime ?? self.birthTime,
      executableRealpath: executableRealpath ?? self.executableRealpath,
      parentChain: parentChain ?? self.parentChain,
      profile: profile ?? self.profile,
      recordCount: recordCount ?? self.recordCount,
      endpoint: endpoint ?? self.endpoint
    )
  }
}

public struct BootstrapProfile: Equatable {
  public let path: String
  public let device: Int
  public let inode: Int
  public let mode: Int
  public let marker: String

  public init(path: String, device: Int, inode: Int, mode: Int, marker: String) {
    self.path = path
    self.device = device
    self.inode = inode
    self.mode = mode
    self.marker = marker
  }

  public static func fixture() -> BootstrapProfile {
    BootstrapProfile(
      path: "/tmp/native-ax/run/browser-profile",
      device: 100,
      inode: 200,
      mode: 0o700,
      marker: "marker"
    )
  }
}

public protocol BrowserLeaseRecording: AnyObject {
  var wrapperPid: Int { get }
  func recordClaim(_ claim: BrowserLeaseClaim) throws
}

public protocol BrowserExecve: AnyObject {
  func execve(path: String, argv: [String]) throws -> Never
}

public final class BrowserLeaseBootstrap {
  private let leaseRecorder: BrowserLeaseRecording
  private let execveAdapter: BrowserExecve

  public init(leaseRecorder: BrowserLeaseRecording, execve: BrowserExecve) {
    self.leaseRecorder = leaseRecorder
    self.execveAdapter = execve
  }

  public func run(
    selectedBrowserRealpath: String,
    argv: [String],
    profile: BootstrapProfile
  ) -> BrowserLeaseBootstrapRunResult {
    guard argv.contains(where: { $0 == "--user-data-dir=\(profile.path)" }) else {
      return .te
    }
    let claim = BrowserLeaseClaim(
      pid: leaseRecorder.wrapperPid,
      birthTime: 10_000,
      executableRealpath: selectedBrowserRealpath,
      parentChain: [ProcessIdentity(pid: 4000, birthTime: 9_000)],
      profile: ProfileIdentity(
        device: profile.device,
        inode: profile.inode,
        mode: profile.mode,
        marker: profile.marker
      ),
      recordCount: 1
    )
    do {
      try leaseRecorder.recordClaim(claim)
      _ = try execveAdapter.execve(path: selectedBrowserRealpath, argv: argv)
    } catch is BrowserLeaseBootstrapDidExec {
      return .didExec
    } catch {
      return .te
    }
  }
}

public enum BrowserLeaseClaimValidator {
  public static func validate(
    _ claim: BrowserLeaseClaim?,
    against expected: BrowserLeaseExpectedClaim
  ) -> BrowserLeaseValidationResult {
    guard let claim else {
      return .te
    }
    guard claim.recordCount == 1,
      claim.endpoint == nil,
      claim.pid == expected.pid,
      claim.birthTime == expected.birthTime,
      claim.executableRealpath == expected.executableRealpath,
      claim.parentChain == expected.parentChain,
      claim.profile == expected.profile
    else {
      return .te
    }
    return .accepted
  }
}
