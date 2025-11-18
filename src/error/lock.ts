export class LockingError extends Error {
  constructor(message?: string) {
    super(message ?? 'Unknown Lock Error')
  }
}

export class LockError extends LockingError {
  constructor(message?: string) {
    super(message ?? 'Lock Error')
  }
}

export class RelockError extends LockingError {
  constructor(message?: string) {
    super(message ?? 'Relock Error')
  }
}

export class UnlockError extends LockingError {
  constructor(message?: string) {
    super(message ?? 'Unlock Error')
  }
}
