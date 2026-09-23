import Foundation

public enum DescriptorCleanupOutcome: Equatable, Sendable {
  case localManualWitnessRequired
  case te
}

public struct RunRootIdentity: Equatable, Sendable {
  public let id: String

  public init(id: String) {
    self.id = id
  }

  public static func fixture() -> RunRootIdentity {
    RunRootIdentity(id: "test-owned-run-root")
  }
}

public enum CleanupLeaf: Equatable, Sendable {
  case browserProfile
  case sinkSession
  case runRoot
}

public enum DescriptorCleanupError: Error {
  case ambiguous
}

public protocol DescriptorFilesystem: AnyObject {
  var ownedRoot: RunRootIdentity { get }
  func verifyFinalMarkers() -> Bool
  func unlinkExact(_ leaf: CleanupLeaf) throws
  func retainWholeRoot()
}

public enum OwnedProcessCloseRequest: Equatable, Sendable {
  case normalPlaywrightClose
}

public enum OwnedProcessSignal: Equatable, Sendable {
  case prohibited
}

public struct OwnedProcessIdentity: Equatable, Sendable {
  public let id: String

  public init(id: String) {
    self.id = id
  }

  public static func browserFixture() -> OwnedProcessIdentity {
    OwnedProcessIdentity(id: "browser")
  }
}

public enum OwnedSnapshotDecision: Equatable, Sendable {
  case stable([OwnedProcessIdentity])
  case ambiguous
}

public protocol OwnedProcessLedger: AnyObject {
  func takeTwoSnapshots() -> OwnedSnapshotDecision
  func requestNormalPlaywrightClose()
  func waitForExactExit() -> Bool
  func signal(_ signal: OwnedProcessSignal)
}

public final class DescriptorAnchoredCleanup {
  private let filesystem: DescriptorFilesystem
  private let processLedger: OwnedProcessLedger

  public init(filesystem: DescriptorFilesystem, processLedger: OwnedProcessLedger) {
    self.filesystem = filesystem
    self.processLedger = processLedger
  }

  public func closeAndCleanup() -> DescriptorCleanupOutcome {
    guard case .stable = processLedger.takeTwoSnapshots() else {
      filesystem.retainWholeRoot()
      return .te
    }
    processLedger.requestNormalPlaywrightClose()
    guard processLedger.waitForExactExit(), filesystem.verifyFinalMarkers() else {
      filesystem.retainWholeRoot()
      return .te
    }
    do {
      try filesystem.unlinkExact(.browserProfile)
      try filesystem.unlinkExact(.sinkSession)
      try filesystem.unlinkExact(.runRoot)
      return .localManualWitnessRequired
    } catch {
      filesystem.retainWholeRoot()
      return .te
    }
  }

  public static let requiredTokens = [
    "mkdtemp",
    "mkdirat",
    "openat",
    "O_NOFOLLOW",
    "fstatat",
    "AT_SYMLINK_NOFOLLOW",
    "unlinkat",
    "st_dev",
    "st_ino",
    "snapshot",
    "retain",
    "Playwright",
    "timeout",
    "marker",
  ]
}
