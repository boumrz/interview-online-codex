export async function runObservedProtocolCommand({ command, cancellation, timeoutMs = 5000, description = 'unspecified' }) {
  let timer;
  const outcomes = [Promise.resolve().then(command).then(value => ({ kind: 'response', value }))];
  if (cancellation) outcomes.push(Promise.resolve(cancellation).then(proof => proof?.proven === true
    ? { kind: 'cancelled', proof } : new Promise(() => {})));
  outcomes.push(new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Protocol command deadline exceeded: ${description}`);
      error.name = 'ProtocolCommandTimeoutError';
      reject(error);
    }, timeoutMs);
  }));
  // Promise.race installs rejection handlers on every loser. A canceled CDP
  // command may reject later when its own session is detached during cleanup.
  try { return await Promise.race(outcomes); }
  finally { clearTimeout(timer); }
}

export async function withProtocolDeadline(command, description, timeoutMs = 5000) {
  return (await runObservedProtocolCommand({ command, description, timeoutMs })).value;
}
