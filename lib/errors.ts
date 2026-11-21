import type { ErrorCode } from "./types";

// One error type for the whole pipeline. `message` is safe to show to the user;
// `detail` is for server logs only.
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public httpStatus = 400,
    public detail?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
