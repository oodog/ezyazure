import { useMsal } from '@azure/msal-react'

export default function TopNav() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]

  const handleLogout = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: '/' })
  }

  return (
    <header className="bg-white border-b border-gray-200 flex items-center justify-between px-6 py-3 shrink-0">
      <div />
      <div className="flex items-center gap-4">
        {account && (
          <span className="text-sm text-gray-600">{account.name ?? account.username}</span>
        )}
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
