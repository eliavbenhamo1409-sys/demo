import { Boot } from "@/components/worker";

/** Shown at once while a screen opens, so a tap always answers. */
export default function Loading() {
  return <Boot label="פותח את המסך" />;
}
