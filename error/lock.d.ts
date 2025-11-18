export declare class LockingError extends Error {
    constructor(message?: string);
}
export declare class LockError extends LockingError {
    constructor(message?: string);
}
export declare class RelockError extends LockingError {
    constructor(message?: string);
}
export declare class UnlockError extends LockingError {
    constructor(message?: string);
}
