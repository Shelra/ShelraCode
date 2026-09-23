import { makeIcon } from "@/components/ui/Icons";

/*
 * The dashboard's icon set (Lucide shapes, MIT), built with the same helper as
 * the site's icons so they share size, stroke and colour handling.
 */
const p = (d: string) => ({ d, transform: "" });

export const DashboardIcon = makeIcon(
  "Overview",
  [p("M3 3h7v9H3z"), p("M14 3h7v5h-7z"), p("M14 12h7v9h-7z"), p("M3 16h7v5H3z")],
  1.5,
);
export const MissionsIcon = makeIcon("Missions", [p("m4 17 6-6-6-6"), p("M12 19h8")], 1.5);
export const AgentsIcon = makeIcon(
  "Agents",
  [p("M12 8V4H8"), p("M4 8h16v12H4z"), p("M2 14h2"), p("M20 14h2"), p("M15 13v2"), p("M9 13v2")],
  1.5,
);
export const ReposIcon = makeIcon(
  "Repositories",
  [
    p(
      "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
    ),
  ],
  1.5,
);
export const UsageIcon = makeIcon("Usage", [p("M22 12h-4l-3 9L9 3l-3 9H2")], 1.5);
export const BillingIcon = makeIcon("Billing", [p("M2 5h20v14H2z"), p("M2 10h20")], 1.5);
export const KeyIcon = makeIcon(
  "API keys",
  [
    p("m21 2-2 2"),
    p("m19 4-3.5 3.5"),
    p("m15.5 7.5 3 3L22 7l-3-3"),
    p("M11.39 11.61a5.5 5.5 0 1 0 1 1"),
    p("m15.5 7.5-4.11 4.11"),
  ],
  1.5,
);
export const TeamIcon = makeIcon(
  "Team",
  [
    p("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"),
    p("M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"),
    p("M22 21v-2a4 4 0 0 0-3-3.87"),
    p("M16 3.13a4 4 0 0 1 0 7.75"),
  ],
  1.5,
);
export const IntegrationsIcon = makeIcon(
  "Integrations",
  [p("M12 22v-5"), p("M9 8V2"), p("M15 8V2"), p("M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z")],
  1.5,
);
export const ActivityIcon = makeIcon(
  "Activity",
  [p("M8 6h13"), p("M8 12h13"), p("M8 18h13"), p("M3 6h.01"), p("M3 12h.01"), p("M3 18h.01")],
  1.5,
);
export const SettingsIcon = makeIcon(
  "Settings",
  [
    p(
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    ),
    p("M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"),
  ],
  1.5,
);
export const SearchIcon = makeIcon("Search", [p("M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z"), p("m21 21-4.3-4.3")], 1.5);
export const BellIcon = makeIcon(
  "Notifications",
  [p("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"), p("M10.3 21a1.94 1.94 0 0 0 3.4 0")],
  1.5,
);
export const ChevronDownIcon = makeIcon("Chevron down", [p("m6 9 6 6 6-6")], 1.5);
export const ChevronRightIcon = makeIcon("Chevron right", [p("m9 18 6-6-6-6")], 1.5);
export const ChevronLeftIcon = makeIcon("Chevron left", [p("m15 18-6-6 6-6")], 1.5);
export const CopyIcon = makeIcon(
  "Copy",
  [p("M8 8h12v12H8z"), p("M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2")],
  1.5,
);
export const TrashIcon = makeIcon(
  "Delete",
  [p("M3 6h18"), p("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"), p("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2")],
  1.5,
);
export const ExternalLinkIcon = makeIcon(
  "Open",
  [p("M15 3h6v6"), p("M10 14 21 3"), p("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6")],
  1.5,
);
export const PlayIcon = makeIcon("Resume", [p("m6 4 14 8-14 8z")], 1.5);
export const PauseIcon = makeIcon("Pause", [p("M6 4h4v16H6z"), p("M14 4h4v16h-4z")], 1.5);
export const RetryIcon = makeIcon(
  "Retry",
  [p("M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"), p("M21 3v5h-5")],
  1.5,
);
export const LogOutIcon = makeIcon(
  "Sign out",
  [p("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"), p("m16 17 5-5-5-5"), p("M21 12H9")],
  1.5,
);
export const PullRequestIcon = makeIcon(
  "Pull request",
  [
    p("M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"),
    p("M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"),
    p("M13 6h3a2 2 0 0 1 2 2v7"),
    p("M6 9v12"),
  ],
  1.5,
);
export const ClockIcon = makeIcon("Time", [p("M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"), p("M12 7v5l3 2")], 1.5);
export const AlertIcon = makeIcon(
  "Warning",
  [p("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"), p("M12 9v4"), p("M12 17h.01")],
  1.5,
);
export const DownloadIcon = makeIcon(
  "Download",
  [p("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), p("m7 10 5 5 5-5"), p("M12 15V3")],
  1.5,
);
export const PanelIcon = makeIcon("Menu", [p("M3 3h18v18H3z"), p("M9 3v18")], 1.5);
export const SparkIcon = makeIcon(
  "New",
  [p("M12 3v18"), p("M3 12h18"), p("m5.6 5.6 12.8 12.8"), p("m18.4 5.6-12.8 12.8")],
  1.5,
);
export const FileIcon = makeIcon(
  "File",
  [p("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"), p("M14 2v5h5")],
  1.5,
);
export const UserIcon = makeIcon(
  "User",
  [p("M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"), p("M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z")],
  1.5,
);
