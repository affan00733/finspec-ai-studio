import {
  Activity,
  BookMarked,
  ClipboardCheck,
  Compass,
  FileText,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  MessagesSquare,
  PenLine,
  ScanSearch,
  Settings,
  Table2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}
export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/app/walkthrough', label: 'Guided walkthrough', icon: Compass },
    ],
  },
  {
    label: 'Corpus & specs',
    items: [
      { to: '/app/documents', label: 'Documents', icon: FileText },
      { to: '/app/specs', label: 'Specs Catalog', icon: BookMarked },
    ],
  },
  {
    label: 'Build',
    items: [
      { to: '/app/prompts', label: 'Prompt Studio', icon: PenLine },
      { to: '/app/workflow', label: 'Agent Workflow', icon: Workflow },
      { to: '/app/retrieval', label: 'Retrieval Explorer', icon: ScanSearch },
    ],
  },
  {
    label: 'Run & review',
    items: [
      { to: '/app/extraction', label: 'Extraction Workbench', icon: Table2 },
      { to: '/app/chat', label: 'Research Chat', icon: MessagesSquare },
      { to: '/app/review', label: 'Review Queue', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Govern',
    items: [
      { to: '/app/evaluation', label: 'Evaluation Lab', icon: FlaskConical },
      { to: '/app/versions', label: 'Version Registry', icon: GitBranch },
      { to: '/app/monitoring', label: 'Monitoring & Audit', icon: Activity },
      { to: '/app/settings', label: 'Settings', icon: Settings },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)
