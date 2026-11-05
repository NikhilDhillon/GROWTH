/** Blends two #rrggbb colours. An amount of 0 gives `from` and 1 gives `to`. */
export function mixHexColors(from: string, to: string, amount: number) {
  const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map((index) => Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
