import SignOut from "./SignOut";

export const Logo = () => (
  <svg viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" fill="none" stroke="#5CE1FF" strokeWidth="2" /><path d="M8 18c0-3 2-4 5-4s5-1 5-4-2-4-5-4" fill="none" stroke="#E4F2FA" strokeWidth="2" strokeLinecap="round" /><circle cx="8" cy="18" r="1.8" fill="#FF4D5E" /></svg>
);

export default function Header({ user, current }) {
  return (
    <header className="top">
      <div className="wrap">
        <a className="brand" href={user ? "/dashboard" : "/"}><Logo />Plainsight</a>
        {user && (
          <nav>
            <a href="/dashboard" aria-current={current === "dashboard" ? "page" : undefined}>Maps</a>
            <a href="/settings" aria-current={current === "settings" ? "page" : undefined}>Connect</a>
            <span className="muted small">{user.email}</span>
            <SignOut />
          </nav>
        )}
      </div>
    </header>
  );
}
