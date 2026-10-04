export function inspectionMessage(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const code = typeof value.code === "string" ? value.code : "";
    const message = typeof value.message === "string" ? value.message : "";
    if (code && message) return `${code}: ${message}`;
    if (message) return message;
    return JSON.stringify(value);
  }
  return String(value ?? "Unavailable");
}
