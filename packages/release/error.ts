import { PublisherError } from "../model/index.ts";

export class ReleaseError extends PublisherError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ReleaseError";
  }
}
