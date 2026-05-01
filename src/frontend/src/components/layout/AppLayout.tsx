import { ReactNode } from 'react'
import Sidebar from './Sidebar'
import TopNav from './TopNav'

interface Props {
  children: ReactNode
}

export default function AppLayout({ children }: Props) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopNav />
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
