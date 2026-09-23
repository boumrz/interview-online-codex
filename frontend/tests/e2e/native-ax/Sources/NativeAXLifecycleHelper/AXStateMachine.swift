import Foundation

public enum NativeAXFocusAction: Equatable, Sendable {
  case raiseSink
  case raiseBrowser
}

public protocol NativeAXFocusActions: AnyObject {
  func perform(_ action: NativeAXFocusAction) -> NativeAXFocusOutcome
}

private enum NativeAXFocusState {
  case ADMITTED
  case LEASED
  case WITNESS_CONFIRMED
  case SINK_RAISED
  case BROWSER_BACKGROUND_WITNESSED
  case BROWSER_RAISED
  case CLOSING
  case terminal
}

public struct NativeAXFocusStateMachine {
  private let actions: NativeAXFocusActions
  private var state: NativeAXFocusState = .ADMITTED

  public init(actions: NativeAXFocusActions) {
    self.actions = actions
  }

  public mutating func confirmWitness(manualWitness: Bool) -> NativeAXFocusOutcome {
    guard state == .ADMITTED, manualWitness else {
      state = .terminal
      return .te
    }
    state = .WITNESS_CONFIRMED
    return .accepted
  }

  public mutating func raiseSink() -> NativeAXFocusOutcome {
    guard state == .WITNESS_CONFIRMED else {
      state = .terminal
      return .te
    }
    let outcome = actions.perform(.raiseSink)
    state = outcome == .accepted ? .SINK_RAISED : .terminal
    return outcome
  }

  public mutating func browserBackgroundWitnessed() -> NativeAXFocusOutcome {
    guard state == .SINK_RAISED else {
      state = .terminal
      return .te
    }
    state = .BROWSER_BACKGROUND_WITNESSED
    return .accepted
  }

  public mutating func raiseBrowser() -> NativeAXFocusOutcome {
    guard state == .BROWSER_BACKGROUND_WITNESSED else {
      state = .terminal
      return .te
    }
    let outcome = actions.perform(.raiseBrowser)
    state = outcome == .accepted ? .BROWSER_RAISED : .terminal
    return outcome
  }

  public mutating func close() -> NativeAXFocusOutcome {
    guard state == .BROWSER_RAISED else {
      state = .terminal
      return .te
    }
    state = .CLOSING
    return .accepted
  }

  public static let requiredActionToken = "kAXRaiseAction"
}
