import Darwin
import Foundation

public enum BrowserLeaseBootstrapMain {
  public static func requiredBoundaryTokens() -> [String] {
    [
      "BrowserLeaseBootstrap",
      "user-data-dir",
      "getpid()",
      "openat(",
      "O_CREAT | O_EXCL",
      "execve(",
    ]
  }
}

