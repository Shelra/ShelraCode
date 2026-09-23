import type { IconProps } from "@/components/ui/Icons";
import {
  ActivityIcon,
  AgentsIcon,
  BillingIcon,
  DashboardIcon,
  IntegrationsIcon,
  KeyIcon,
  MissionsIcon,
  ReposIcon,
  SettingsIcon,
  TeamIcon,
  UsageIcon,
} from "./icons";

export type NavItem = {
  href: string;
  label: string;
  badge: string;
  icon: (props: IconProps) => React.JSX.Element;
  exact?: boolean;
};

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "WORKSPACE",
    items: [
      { href: "/dashboard", label: "Overview", badge: "OVERVIEW", icon: DashboardIcon, exact: true },
      { href: "/dashboard/missions", label: "Missions", badge: "MISSIONS", icon: MissionsIcon },
      { href: "/dashboard/agents", label: "Agents", badge: "AGENTS", icon: AgentsIcon },
      { href: "/dashboard/repos", label: "Repositories", badge: "REPOSITORIES", icon: ReposIcon },
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      { href: "/dashboard/usage", label: "Usage", badge: "USAGE", icon: UsageIcon },
      { href: "/dashboard/billing", label: "Billing", badge: "BILLING", icon: BillingIcon },
      { href: "/dashboard/api-keys", label: "API keys", badge: "API KEYS", icon: KeyIcon },
      { href: "/dashboard/team", label: "Team", badge: "TEAM", icon: TeamIcon },
      { href: "/dashboard/integrations", label: "Integrations", badge: "INTEGRATIONS", icon: IntegrationsIcon },
      { href: "/dashboard/activity", label: "Activity", badge: "ACTIVITY", icon: ActivityIcon },
      { href: "/dashboard/settings", label: "Settings", badge: "SETTINGS", icon: SettingsIcon },
    ],
  },
];

export const navItems = navGroups.flatMap((g) => g.items);

export function activeItem(pathname: string): NavItem | undefined {
  return navItems.find((item) => (item.exact ? pathname === item.href : pathname.startsWith(item.href)));
}
