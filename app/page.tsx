import { Suspense } from "react";
import Portal from "@/app/portal";
import PortalPage from "@/app/portal-page";

export default function Home() {
  return (
    <Suspense fallback={<Portal actor={null} resources={[]} notices={[]} />}>
      <PortalPage />
    </Suspense>
  );
}
