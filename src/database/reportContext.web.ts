export async function readReportContext(key: string): Promise<string | null> {
  return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
}
export async function writeReportContext(key: string, value: string) {
  if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
}
