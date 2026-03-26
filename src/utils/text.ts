export function compactWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }
  
  export function lowercase(value: string): string {
    return value.toLowerCase();
  }