/**
 * An attribute-value escaper that survives a host page defining its own global `CSS` (a lexical string of stylesheet text
 * shadows the bare name, so calling its escape member throws). The native implementation is looked up on the global
 * object, which the shadow does not touch; without it the CSSOM "serialize an identifier" algorithm applies.
 */
export function cssEscape(value: string): string {
  const native = (globalThis as { CSS?: { escape?: unknown } }).CSS;
  if (native && typeof native === 'object' && typeof native.escape === 'function') return (native.escape as (input: string) => string)(value);
  return escapeIdentifier(String(value));
}

export function escapeIdentifier(value: string): string {
  const length = value.length;
  let result = '';
  for (let index = 0; index < length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) { result += '�'; continue; }
    const digit = code >= 0x30 && code <= 0x39;
    const control = (code >= 0x1 && code <= 0x1f) || code === 0x7f;
    if (control || (index === 0 && digit) || (index === 1 && digit && value.charCodeAt(0) === 0x2d)) {
      result += '\\' + code.toString(16) + ' ';
      continue;
    }
    if (index === 0 && length === 1 && code === 0x2d) { result += '\\' + value.charAt(index); continue; }
    const plain = code >= 0x80 || code === 0x2d || code === 0x5f || digit || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    result += plain ? value.charAt(index) : '\\' + value.charAt(index);
  }
  return result;
}
