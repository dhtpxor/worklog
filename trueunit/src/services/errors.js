export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (msg, code = "invalid_request") => new HttpError(400, code, msg);
export const notFound = (what = "대상") => new HttpError(404, "not_found", `${what}을(를) 찾을 수 없습니다`);
export const conflict = (msg, code = "conflict") => new HttpError(409, code, msg);
