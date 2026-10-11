import Svg, { Rect } from "react-native-svg";

import { useThemePalette } from "@/utils/themedStyles";

const BAR = "#8a8a8a";
const GREEN = "#7bcf9a";

// Shaft, sleeve, collar, a loaded plate and the newest plate, in drawing order.
const SHAPES = [
  { x: 12, y: 57, width: 20, height: 6, rx: 3, fill: BAR },
  { x: 30, y: 56, width: 76, height: 8, rx: 4, fill: BAR },
  { x: 26, y: 48, width: 7, height: 24, rx: 2.5, fill: BAR },
  { x: 36, y: 25, width: 14, height: 70, rx: 4, fill: "#ececec" },
  { x: 53, y: 25, width: 14, height: 70, rx: 4, fill: GREEN }
];

/**
 * The GROWTH mark: a barbell end loaded from the collar outward, the newest plate in
 * green and a faint slot for the next one. Same 120-unit geometry as assets/logo.svg
 * and scripts/generate-brand-assets.py. Brand colours stay fixed in both themes; a
 * hairline keeps the dark tile visible on the dark app background.
 */
export function LogoMark({ size = 36 }: { size?: number }) {
  const palette = useThemePalette();
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" accessibilityLabel="GROWTH logo">
      <Rect x={0.75} y={0.75} width={118.5} height={118.5} rx={28} fill="#0d0d0d" stroke={palette.border} strokeWidth={1.5} />
      {SHAPES.map((shape) => <Rect key={`${shape.x}-${shape.y}`} {...shape} />)}
      <Rect x={70} y={25} width={14} height={70} rx={4} fill={GREEN} fillOpacity={0.3} />
    </Svg>
  );
}
