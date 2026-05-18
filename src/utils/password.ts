export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string, email: string) {
  const input = `${normalizeEmail(email)}:${password}`;
  let hash = 5381;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }

  return `local-${(hash >>> 0).toString(16)}`;
}
