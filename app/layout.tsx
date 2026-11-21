import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCAF | Adaptive Access Framework",
  description: "Adaptive multi-context access control workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
