import type { ComponentType } from "react";
import { Anchor } from "@phosphor-icons/react/dist/csr/Anchor";
import { Archive } from "@phosphor-icons/react/dist/csr/Archive";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { ArrowsOut } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { Books } from "@phosphor-icons/react/dist/csr/Books";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CircleNotch } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { Command } from "@phosphor-icons/react/dist/csr/Command";
import { Copy } from "@phosphor-icons/react/dist/csr/Copy";
import { Crosshair } from "@phosphor-icons/react/dist/csr/Crosshair";
import { Cube } from "@phosphor-icons/react/dist/csr/Cube";
import { Cursor } from "@phosphor-icons/react/dist/csr/Cursor";
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree";
import { Export } from "@phosphor-icons/react/dist/csr/Export";
import { Eye } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlash } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { FileArrowUp } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { FileCode } from "@phosphor-icons/react/dist/csr/FileCode";
import { FileText } from "@phosphor-icons/react/dist/csr/FileText";
import { FunnelSimple } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { FloppyDisk } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { Gear } from "@phosphor-icons/react/dist/csr/Gear";
import { GridFour } from "@phosphor-icons/react/dist/csr/GridFour";
import { Hand } from "@phosphor-icons/react/dist/csr/Hand";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { Keyboard } from "@phosphor-icons/react/dist/csr/Keyboard";
import { Lightning } from "@phosphor-icons/react/dist/csr/Lightning";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { Lock } from "@phosphor-icons/react/dist/csr/Lock";
import { LockOpen } from "@phosphor-icons/react/dist/csr/LockOpen";
import { Magnet } from "@phosphor-icons/react/dist/csr/Magnet";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { MagnifyingGlassMinus } from "@phosphor-icons/react/dist/csr/MagnifyingGlassMinus";
import { MagnifyingGlassPlus } from "@phosphor-icons/react/dist/csr/MagnifyingGlassPlus";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { Play } from "@phosphor-icons/react/dist/csr/Play";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { PlusCircle } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { Pulse } from "@phosphor-icons/react/dist/csr/Pulse";
import { Ruler } from "@phosphor-icons/react/dist/csr/Ruler";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SidebarSimple } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { Sparkle } from "@phosphor-icons/react/dist/csr/Sparkle";
import { Square } from "@phosphor-icons/react/dist/csr/Square";
import { SquaresFour } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { Stack } from "@phosphor-icons/react/dist/csr/Stack";
import { Target } from "@phosphor-icons/react/dist/csr/Target";
import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { XCircle } from "@phosphor-icons/react/dist/csr/XCircle";

type PhosphorProps = {
  size?: number | string;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  color?: string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
};

const iconMap = {
  anchor: Anchor,
  archive: Archive,
  undo: ArrowCounterClockwise,
  redo: ArrowClockwise,
  external: ArrowUpRight,
  fit: ArrowsOut,
  sync: ArrowsClockwise,
  books: Books,
  chevronDown: CaretDown,
  chevronLeft: CaretLeft,
  chevronRight: CaretRight,
  check: Check,
  checkCircle: CheckCircle,
  spinner: CircleNotch,
  history: ClockCounterClockwise,
  command: Command,
  copy: Copy,
  guide: Crosshair,
  cube: Cube,
  cursor: Cursor,
  more: DotsThree,
  export: Export,
  eye: Eye,
  eyeOff: EyeSlash,
  upload: FileArrowUp,
  ufo: FileCode,
  fileText: FileText,
  filter: FunnelSimple,
  save: FloppyDisk,
  folderOpen: FolderOpen,
  gear: Gear,
  grid: GridFour,
  hand: Hand,
  info: Info,
  keyboard: Keyboard,
  lightning: Lightning,
  listChecks: ListChecks,
  lock: Lock,
  unlock: LockOpen,
  magnet: Magnet,
  search: MagnifyingGlass,
  zoomOut: MagnifyingGlassMinus,
  zoomIn: MagnifyingGlassPlus,
  minus: Minus,
  play: Play,
  plus: Plus,
  add: PlusCircle,
  pulse: Pulse,
  ruler: Ruler,
  shield: ShieldCheck,
  sidebar: SidebarSimple,
  sliders: SlidersHorizontal,
  sparkle: Sparkle,
  square: Square,
  squares: SquaresFour,
  stack: Stack,
  target: Target,
  trash: Trash,
  warning: WarningCircle,
  close: X,
  error: XCircle,
} satisfies Record<string, ComponentType<PhosphorProps>>;

export type IconName = keyof typeof iconMap;

interface IconProps extends PhosphorProps {
  name: IconName;
}

/** Single wrapper so the icon set can be swapped without touching call sites. */
export function Icon({ name, size = 18, weight = "regular", ...rest }: IconProps) {
  const Component = iconMap[name];
  return <Component size={size} weight={weight} aria-hidden="true" {...rest} />;
}
