import { Suspense } from "react";
import { AssistantView } from "@/modules/assistant/assistant-view";
export default function AssistantPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          Đang tải Nova Assistant…
        </div>
      }
    >
      <AssistantView />
    </Suspense>
  );
}
