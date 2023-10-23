export const encode = (data: any): string => {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
};

export function decode<T>(data: string): T {
  return JSON.parse(decodeURIComponent(escape(atob(data))));
}
