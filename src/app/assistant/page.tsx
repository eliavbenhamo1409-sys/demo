import type { Metadata } from "next";
import { AssistantPage } from "@/components/assistant/AssistantPage";

export const metadata: Metadata = { title: "עוזר AI · ניהול מלאי" };

/** The assistant: the morning's briefing, the alerts and the conversation. Reached from the rail. */
export default function Page() {
  return <AssistantPage />;
}
