// Existing deployments can reuse their storage namespace and password variable.
export const INSTALLATION_NAMESPACE = process.env.RECORDER_INSTALLATION_NAMESPACE || "drill";

export function recorderPassword() {
  return process.env.RECORDER_PASSWORD || process.env[`${INSTALLATION_NAMESPACE.toUpperCase()}_PASSWORD`];
}
