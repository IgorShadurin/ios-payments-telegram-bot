import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "iOS Payments Telegram Bot",
  description: "Verified App Store Server Notifications forwarded to Telegram.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
