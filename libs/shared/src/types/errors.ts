export enum ErrorCode {
  VALIDATION = 'VALIDATION',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  EADDRINUSE = 'EADDRINUSE',
  EACCES_PRIVILEGED_PORT = 'EACCES_PRIVILEGED_PORT',
  EACCES = 'EACCES',
  ETARGET_UNREACHABLE = 'ETARGET_UNREACHABLE',
  INTERNAL = 'INTERNAL',
}

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.EADDRINUSE]: 409,
  [ErrorCode.EACCES_PRIVILEGED_PORT]: 403,
  [ErrorCode.EACCES]: 403,
  [ErrorCode.ETARGET_UNREACHABLE]: 502,
  [ErrorCode.INTERNAL]: 500,
};

export interface ApiErrorDetails {
  [key: string]: unknown;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: ApiErrorDetails;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details?: ApiErrorDetails;

  constructor(code: ErrorCode, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toResponse(): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}
