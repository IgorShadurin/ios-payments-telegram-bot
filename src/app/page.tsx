export default function Home() {
  return (
    <main>
      <p className="eyebrow">Service online</p>
      <h1>iOS payments → Telegram</h1>
      <p>
        This service verifies App Store Server Notifications V2, stores each
        event in SQLite, and forwards it to Telegram.
      </p>
      <div className="endpoints">
        <code>POST /api/apple/notifications</code>
        <code>GET /api/health</code>
      </div>
      <p className="muted">
        Apps are managed with the command-line tool. See the project README for
        setup and deployment instructions.
      </p>
    </main>
  );
}
