import { useState } from "react";

import { ProgressTab, ProgressTabs } from "@/components/ProgressTabs";
import { AnalyticsScreen } from "@/screens/Analytics/AnalyticsScreen";
import { BodyMeasurementsScreen } from "@/screens/BodyMeasurements/BodyMeasurementsScreen";
import { BulkAnalyticsScreen } from "@/screens/BulkAnalytics/BulkAnalyticsScreen";

export function ProgressScreen() {
  const [tab, setTab] = useState<ProgressTab>("overview");
  const progressTabs = <ProgressTabs value={tab} onChange={setTab} />;

  if (tab === "strength") return <AnalyticsScreen progressTabs={progressTabs} />;
  if (tab === "body") return <BodyMeasurementsScreen progressTabs={progressTabs} />;
  return <BulkAnalyticsScreen progressTabs={progressTabs} />;
}
