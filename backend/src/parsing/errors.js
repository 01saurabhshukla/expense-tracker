// A problem with the statement's contents, found while processing it in the
// background. Unlike AppError there's no HTTP status: nobody is waiting on a
// request. The job records `code` and `message` on the upload as the reason
// it failed, and the frontend shows them.
export class ParseError extends Error {
  constructor(code, message, { line, details } = {}) {
    super(message);
    this.code = code;
    this.line = line;
    this.details = details;
  }
}
