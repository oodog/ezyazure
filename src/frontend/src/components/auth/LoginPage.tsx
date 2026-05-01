import { useMsal } from '@azure/msal-react'
import { loginRequest } from '@/auth/authConfig'

export default function LoginPage() {
  const { instance } = useMsal()

  const handleLogin = () => {
    instance.loginRedirect(loginRequest)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-azure-500 relative overflow-hidden">
      {/* Subtle background rings */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full border border-white/10" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full border border-white/10" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full border border-white/10" />
      </div>

      <div className="relative w-full max-w-sm mx-4">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 pt-8 pb-9">
            {/* Logo mark */}
            <div className="flex items-center gap-3 mb-7">
              <div className="w-9 h-9 rounded-xl bg-azure-500 flex items-center justify-center shadow-sm">
                <span className="text-white font-black text-sm tracking-tight select-none">EA</span>
              </div>
              <span className="text-xl font-bold text-gray-900 tracking-tight">EasyAzure</span>
            </div>

            <h1 className="text-2xl font-bold text-gray-900 mb-1.5">Welcome back</h1>
            <p className="text-sm text-gray-500 mb-7 leading-relaxed">
              Sign in with your Microsoft account to manage and discover your Azure environments.
            </p>

            <button
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-3 bg-azure-500 hover:bg-azure-600 active:bg-azure-700 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors duration-150 shadow-sm"
            >
              {/* Microsoft logo mark */}
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Sign in with Microsoft
            </button>

            <p className="mt-5 text-xs text-gray-400 text-center leading-relaxed">
              Secured by Microsoft Entra ID.&nbsp;
              Your credentials are never seen or stored by this application.
            </p>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-white/60">
          EasyAzure &mdash; Azure environment management platform
        </p>
      </div>
    </div>
  )
}
