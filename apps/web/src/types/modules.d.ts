/**
 * Module declarations for third-party libraries whose bundled type
 * declarations are not properly exported in the installed versions.
 */

declare module 'lucide-react' {
  import { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react';

  export interface LucideProps extends SVGProps<SVGSVGElement> {
    size?: number | string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
    color?: string;
  }

  export type LucideIcon = ForwardRefExoticComponent<
    Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>
  >;

  export const Monitor: LucideIcon;
  export const User: LucideIcon;
  export const Command: LucideIcon;
  export const ChevronsUpDown: LucideIcon;
  export const KeyRound: LucideIcon;
  export const PlusCircle: LucideIcon;
  export const Ticket: LucideIcon;
  export const Volume2: LucideIcon;

  export const Search: LucideIcon;
  export const X: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const ChevronLeft: LucideIcon;
  export const ChevronDown: LucideIcon;
  export const ChevronUp: LucideIcon;
  export const Home: LucideIcon;
  export const Users: LucideIcon;
  export const UserPlus: LucideIcon;
  export const UserCheck: LucideIcon;
  export const Stethoscope: LucideIcon;
  export const Pill: LucideIcon;
  export const ClipboardList: LucideIcon;
  export const Activity: LucideIcon;
  export const BarChart3: LucideIcon;
  export const Settings: LucideIcon;
  export const LogOut: LucideIcon;
  export const Sun: LucideIcon;
  export const Moon: LucideIcon;
  export const Bell: LucideIcon;
  export const Menu: LucideIcon;
  export const FileText: LucideIcon;
  export const Plus: LucideIcon;
  export const Minus: LucideIcon;
  export const Check: LucideIcon;
  export const AlertTriangle: LucideIcon;
  export const AlertCircle: LucideIcon;
  export const Info: LucideIcon;
  export const Eye: LucideIcon;
  export const EyeOff: LucideIcon;
  export const Lock: LucideIcon;
  export const Unlock: LucideIcon;
  export const Mail: LucideIcon;
  export const Phone: LucideIcon;
  export const Calendar: LucideIcon;
  export const Clock: LucideIcon;
  export const MapPin: LucideIcon;
  export const Building: LucideIcon;
  export const Building2: LucideIcon;
  export const Package: LucideIcon;
  export const PackageOpen: LucideIcon;
  export const Truck: LucideIcon;
  export const ShoppingCart: LucideIcon;
  export const CreditCard: LucideIcon;
  export const DollarSign: LucideIcon;
  export const IndianRupee: LucideIcon;
  export const TrendingUp: LucideIcon;
  export const TrendingDown: LucideIcon;
  export const ArrowUp: LucideIcon;
  export const ArrowDown: LucideIcon;
  export const ArrowLeft: LucideIcon;
  export const RotateCcw: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const Download: LucideIcon;
  export const Upload: LucideIcon;
  export const Printer: LucideIcon;
  export const Copy: LucideIcon;
  export const Trash2: LucideIcon;
  export const Edit: LucideIcon;
  export const Save: LucideIcon;
  export const XCircle: LucideIcon;
  export const CheckCircle: LucideIcon;
  export const CheckCircle2: LucideIcon;
  export const CircleDot: LucideIcon;
  export const Circle: LucideIcon;
  export const Hash: LucideIcon;
  export const Filter: LucideIcon;
  export const SlidersHorizontal: LucideIcon;
  export const MoreHorizontal: LucideIcon;
  export const MoreVertical: LucideIcon;
  export const Maximize2: LucideIcon;
  export const Minimize2: LucideIcon;
  export const ExternalLink: LucideIcon;
  export const Link: LucideIcon;
  export const QrCode: LucideIcon;
  export const Scan: LucideIcon;
  export const Shield: LucideIcon;
  export const ShieldCheck: LucideIcon;
  export const Heart: LucideIcon;
  export const HeartPulse: LucideIcon;
  export const Thermometer: LucideIcon;
  export const Syringe: LucideIcon;
  export const TestTube: LucideIcon;
  export const TestTubes: LucideIcon;
  export const Microscope: LucideIcon;
  export const BedDouble: LucideIcon;
  export const Bed: LucideIcon;
  export const Hospital: LucideIcon;
  export const Ambulance: LucideIcon;
  export const Clipboard: LucideIcon;
  export const ClipboardCheck: LucideIcon;
  export const FileCheck: LucideIcon;
  export const FilePlus: LucideIcon;
  export const FileWarning: LucideIcon;
  export const FolderOpen: LucideIcon;
  export const Archive: LucideIcon;
  export const Box: LucideIcon;
  export const Boxes: LucideIcon;
  export const Warehouse: LucideIcon;
  export const Tag: LucideIcon;
  export const Tags: LucideIcon;
  export const Bookmark: LucideIcon;
  export const Star: LucideIcon;
  export const Award: LucideIcon;
  export const BadgeCheck: LucideIcon;
  export const LayoutDashboard: LucideIcon;
  export const PanelLeft: LucideIcon;
  export const PanelLeftClose: LucideIcon;
  export const PanelLeftOpen: LucideIcon;
  export const Loader2: LucideIcon;
  export const Sparkles: LucideIcon;
  export const Zap: LucideIcon;
  export const Receipt: LucideIcon;
  export const ReceiptText: LucideIcon;
  export const ScrollText: LucideIcon;
  export const ListOrdered: LucideIcon;
  export const List: LucideIcon;
  export const Table: LucideIcon;
  export const Columns: LucideIcon;
  export const Grid: LucideIcon;
  export const BarChart: LucideIcon;
  export const BarChart2: LucideIcon;
  export const PieChart: LucideIcon;
  export const LineChart: LucideIcon;
  export const Wallet: LucideIcon;

  export type { LucideIcon, LucideProps };
}

declare module 'framer-motion' {
  import { ComponentType, ReactNode, HTMLAttributes, RefAttributes } from 'react';

  export interface AnimatePresenceProps {
    children?: ReactNode;
    mode?: 'wait' | 'popLayout' | 'sync';
    initial?: boolean;
    onExitComplete?: () => void;
  }

  export interface MotionProps extends HTMLAttributes<HTMLElement> {
    initial?: object | boolean;
    animate?: object;
    exit?: object;
    transition?: object;
    whileHover?: object;
    whileTap?: object;
    whileInView?: object;
    variants?: object;
    layout?: boolean | string;
    layoutId?: string;
    key?: string | number;
  }

  export const AnimatePresence: ComponentType<AnimatePresenceProps>;
  export const motion: {
    div: ComponentType<MotionProps & HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>>;
    span: ComponentType<MotionProps & HTMLAttributes<HTMLSpanElement> & RefAttributes<HTMLSpanElement>>;
    p: ComponentType<MotionProps & HTMLAttributes<HTMLParagraphElement> & RefAttributes<HTMLParagraphElement>>;
    button: ComponentType<MotionProps & HTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>>;
    a: ComponentType<MotionProps & HTMLAttributes<HTMLAnchorElement> & RefAttributes<HTMLAnchorElement>>;
    ul: ComponentType<MotionProps & HTMLAttributes<HTMLUListElement> & RefAttributes<HTMLUListElement>>;
    li: ComponentType<MotionProps & HTMLAttributes<HTMLLIElement> & RefAttributes<HTMLLIElement>>;
    nav: ComponentType<MotionProps & HTMLAttributes<HTMLElement> & RefAttributes<HTMLElement>>;
    aside: ComponentType<MotionProps & HTMLAttributes<HTMLElement> & RefAttributes<HTMLElement>>;
    header: ComponentType<MotionProps & HTMLAttributes<HTMLElement> & RefAttributes<HTMLElement>>;
    section: ComponentType<MotionProps & HTMLAttributes<HTMLElement> & RefAttributes<HTMLElement>>;
    main: ComponentType<MotionProps & HTMLAttributes<HTMLElement> & RefAttributes<HTMLElement>>;
    [key: string]: ComponentType<any>;
  };
}

declare module 'recharts' {
  import { ComponentType, ReactNode, CSSProperties } from 'react';

  export interface ChartProps {
    width?: number;
    height?: number;
    data?: any[];
    children?: ReactNode;
    margin?: { top?: number; right?: number; bottom?: number; left?: number };
    [key: string]: any;
  }

  export interface AxisProps {
    dataKey?: string;
    stroke?: string;
    fontSize?: number;
    tickLine?: boolean;
    axisLine?: boolean;
    tick?: any;
    tickFormatter?: (value: any) => string;
    [key: string]: any;
  }

  export interface TooltipProps {
    contentStyle?: CSSProperties;
    labelStyle?: CSSProperties;
    itemStyle?: CSSProperties;
    cursor?: boolean | object;
    [key: string]: any;
  }

  export interface LegendProps {
    verticalAlign?: 'top' | 'middle' | 'bottom';
    height?: number;
    iconType?: string;
    [key: string]: any;
  }

  export interface DataSeriesProps {
    dataKey?: string;
    name?: string;
    fill?: string;
    fillOpacity?: number;
    stroke?: string;
    strokeWidth?: number;
    type?: string;
    dot?: boolean | object;
    activeDot?: boolean | object;
    stackId?: string;
    radius?: number | number[];
    barSize?: number;
    innerRadius?: number | string;
    outerRadius?: number | string;
    cx?: string | number;
    cy?: string | number;
    paddingAngle?: number;
    children?: ReactNode;
    label?: any;
    [key: string]: any;
  }

  export interface CellProps {
    fill?: string;
    key?: string;
    [key: string]: any;
  }

  export const ResponsiveContainer: ComponentType<{ width?: string | number; height?: string | number; children?: ReactNode; [key: string]: any }>;
  export const AreaChart: ComponentType<ChartProps>;
  export const BarChart: ComponentType<ChartProps>;
  export const LineChart: ComponentType<ChartProps>;
  export const PieChart: ComponentType<ChartProps>;
  export const Area: ComponentType<DataSeriesProps>;
  export const Bar: ComponentType<DataSeriesProps>;
  export const Line: ComponentType<DataSeriesProps>;
  export const Pie: ComponentType<DataSeriesProps>;
  export const Cell: ComponentType<CellProps>;
  export const XAxis: ComponentType<AxisProps>;
  export const YAxis: ComponentType<AxisProps>;
  export const CartesianGrid: ComponentType<{ strokeDasharray?: string; stroke?: string; vertical?: boolean; [key: string]: any }>;
  export const Tooltip: ComponentType<TooltipProps>;
  export const Legend: ComponentType<LegendProps>;
}
