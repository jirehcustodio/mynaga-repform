export type CategoryEntry = {
  title: string
  committedDays: string
  actualDays: string
  reason: string
  cmoHelp: string
}

export type CaseReport = {
  id?: string
  created_at?: string
  firstName: string
  middleName: string
  lastName: string
  nameSuffix: string
  phone: string
  email: string
  department: string
  categories: CategoryEntry[]
}
