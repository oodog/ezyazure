export interface DataPathRequest {
  sourceResourceId: string
  destinationResourceId: string
  protocol: 'TCP' | 'UDP' | 'ICMP'
  destinationPort: number
  sourcePort?: number
}

export interface PathHop {
  resourceId: string
  resourceName: string
  resourceType: string
  detail?: string
  matchedRule?: string
}

export interface DataPathResult {
  status: 'Allowed' | 'Blocked' | 'Unknown'
  blockingRule?: string
  hops: PathHop[]
  riskNotes: string[]
  bestPracticeNotes?: string[]
}
