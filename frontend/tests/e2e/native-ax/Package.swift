// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "NativeAXHarness",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "BrowserLeaseBootstrap",
      path: "Sources/BrowserLeaseBootstrap"
    ),
    .executableTarget(
      name: "NativeAXFocusSink",
      path: "Sources/NativeAXFocusSink"
    ),
    .target(
      name: "NativeAXLifecycleHelper",
      path: "Sources/NativeAXLifecycleHelper"
    ),
    .testTarget(
      name: "NativeAXHarnessTests",
      dependencies: [
        "BrowserLeaseBootstrap",
        "NativeAXLifecycleHelper",
      ],
      path: "Tests/NativeAXHarnessTests",
    ),
  ],
)
